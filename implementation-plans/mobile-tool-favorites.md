# Mobile tool favorites

## Goal

Let a user star tools in the crease-pattern tool sheet and have the starred ones
collected into a Favorites section at the top of that sheet, directly below the
crease-type chips — so the tools someone actually reaches for stop costing a
scroll through 52 rows.

Everyone starts with a short set of the most-used tools already starred, taken
from PostHog rather than guessed — with one deliberate omission, below.

Favorites are reorderable by long-press-and-drag from the first release, because
the order is the whole point once the list is short: the first row is the one
your thumb reaches without looking.

The surface this ships on is the **phone tool sheet** (`CpToolPickerSheet`), the
only tool surface that layout has. But favoriting is a user preference, not a
phone feature: the store, the default list, the toggle verb, and the star control
are all surface-neutral from the start, so the tablet/desktop rail
(`CpToolRail`) — and eventually a pinned bottom toolbar — can adopt them without
re-deciding anything. Only the *rendering* is phone-only in this change.

### What the data says

`cp tool used` fires at the CP dispatch seam
([projectSlice.ts:2261](apps/web/src/store/workspaceStore/slices/projectSlice.ts:2261))
with an `operation` property, so "most used" is directly answerable. Ranked by
distinct users over the last 90 days (the full life of the event — the 180-day
window returns identical rows):

| # | Operation | Users | Uses | Action id |
| --- | --- | ---: | ---: | --- |
| 1 | `CreaseSelect` | 109 | 2,798 | `cp.action.crease-select` |
| 2 | `LineSegmentDelete` | 67 | 7,123 | `cp.action.line-segment-delete` |
| 3 | `DrawCreaseFree` | 63 | 5,782 | *held out — see below* |
| 4 | `DrawCreaseRestricted` | 41 | 3,257 | `cp.action.draw-crease-restricted` |
| 5 | `CreaseToggleMv` | 33 | 3,755 | `cp.action.crease-toggle-mv` |
| 6 | `DrawCreaseAngleRestricted5` | 28 | 3,019 | `cp.action.draw-crease-angle-restricted5` |
|   | — cut — | | | |
| 7 | `DrawCreaseSymmetric` | 23 | 252 | |

Two things make this cut trustworthy rather than a coin flip:

- **The gap is real.** #6 has 28 users and 3,019 uses; #7 has 23 users and 252
  uses — an order of magnitude fewer invocations. The top six are also the only
  six above 3,000 uses.
- **Phone/tablet sessions alone produce the same six.** Filtering to
  `$device_type IN ('Mobile','Tablet')`: `CreaseSelect` (28 users),
  `DrawCreaseFree` (17), `LineSegmentDelete` (10), `DrawCreaseRestricted` (8),
  `DrawCreaseAngleRestricted5` (5), `CreaseToggleMv` (4). Same set, minor
  reordering. Since this ships mobile-first, the two cuts agreeing is what
  removes the "desktop habits imposed on phones" objection.

This also nearly reproduces the Discord request by hand — grid draw, angle
constrained draw, delete, change M/V are all in it. Two differences are worth
stating: the data adds **`CreaseSelect`**, and does not support
**`VertexSolveFoldAngles`** (8 users, 110 uses — rank ~22).

**`DrawCreaseFree` — plain Line — is held out**, and it is the one place the
shipped set departs from the ranking rather than following it. Third by users and
second by invocations, pulled as a product call. Nothing stops anyone starring
it; it is the first row of the Draw group.

That leaves five defaults, which is `CP_TOOLBAR_FAVORITE_LIMIT` exactly, so the
shipped set fills the phone's bar with nothing left over and hidden. A happy
accident of that edit rather than a constraint — the two numbers answer different
questions and nothing keeps them equal.

`CreaseSelect` deserves a note because it is
`DEFAULT_ORISTUDIO_CP_ACTION_ID`, so every session starts holding it and it is
"free" in a sense the others are not. It stays in the defaults anyway: on a
phone there is no rail, so getting *back* to select after using another tool is
exactly the two-tap round trip this feature exists to remove.

### Non-goals

- A cap on how many tools can be favorited. The store never refuses one; a
  surface with limited room takes the first N it can show.
- Reordering anything outside the Favorites section, or dragging a tool *into*
  Favorites from the groups below. Starring is how a tool gets in.
- Rendering favorites on the tablet/desktop rail. That one is still downstream,
  and named in the checklist as a follow-up.

The bottom pill toolbar was a non-goal here and is no longer: it and the
zoom/pan controls it carried were brought into this change rather than deferred,
because a sheet full of stars while the bar still held zoom buttons was half a
feature. What that took is written up in the checklist and in
`useCpFavoriteToolbarGroup`.

## Approach

### 1. The row is a `<button>` today, and that is the blocking structural problem

`CpToolPickerRow` renders the whole row as one `<button>`
([CpToolPickerSheet.tsx:208](apps/web/src/cp-workspace/toolCatalog/CpToolPickerSheet.tsx:208)).
A star button nested inside it is invalid HTML, and in practice the browser
either drops the inner control or delivers the tap to the outer one — so the
star would silently select the tool instead of favoriting it.

So the row becomes a flex container holding **two sibling buttons**:

```
<li class="cp-tool-picker__row">
  <button class="cp-tool-picker__star" aria-pressed>  ← favorite toggle
  <button class="cp-tool-picker__item">               ← existing select target
</li>
```

The `<li>` takes the layout the `__item` had (flex row, `min-height:
var(--touch-target)`); `__item` keeps the glyph/label/hint/shortcut and grows to
fill. The `[data-active]` styling that currently sits on `__item` (background
tint plus `inset 2px 0 0` left bar) moves to the row, otherwise the active bar
would draw between the star and the glyph rather than at the row's edge.

The star gets its own `min-width/min-height: var(--touch-target)` so it is a
real 44px target and the row's tap area starts after it. Zach asked for the star
on the **left**, which puts it on the reading path — the compensation is that it
is visually quiet (`--text-tertiary` when empty) and the two targets never
overlap.

One icon, two states: lucide's `Star` with `fill="currentColor"` when favorited
and `fill="none"` when not, which is precisely "empty or selected".

### 2. `cpToolFavorites.ts` — a surface-neutral module store

New file `apps/web/src/cp-workspace/toolCatalog/cpToolFavorites.ts`, following
the module-store-plus-`useSyncExternalStore` shape this directory already uses
for `cpToolSurface.ts` and `touchModifiers/shiftLatch.ts`, with persistence via
the central `lib/storage.ts` registry (never raw `localStorage`).

```ts
export const CP_DEFAULT_FAVORITE_ACTION_IDS: readonly OristudioCpActionId[] = [
  'cp.action.crease-select',
  'cp.action.line-segment-delete',
  'cp.action.draw-crease-restricted',
  'cp.action.crease-toggle-mv',
  'cp.action.draw-crease-angle-restricted5',
];
```

Authored as an explicit literal, not computed. The PostHog ranking was a
one-time input and the set is a product decision on top of it, so the list that
ships should be a reviewable line in a diff. Watch the ids: `DrawCreaseFree`
would have been `cp.action.draw-crease`, **not**
`cp.action.draw-crease-free` — it is the one operation with an id override
([oristudioCpActions.ts:163](apps/web/src/lib/oristudioCpActions.ts:163)), and
deriving the id from the operation name by hand is how this gets silently wrong.
A test asserts every default id resolves through `cpActionById`.

**Absent key means "use the defaults", and that is the load-bearing decision.**
The stored value is only written on the first toggle, at which point the
defaults are materialized into the array along with the change. Consequences,
both intended:

- A user who never customizes tracks whatever we ship. If the ranking is
  re-run in six months and the defaults change, they get the better list.
- A user who un-stars one default persists an explicit five-item list and is
  never surprised by a later default change. Their edit is the whole record.

Stored shape carries a version so a future migration has something to branch on:

```ts
interface StoredCpToolFavorites { version: 1; ids: string[] }
```

Reads validate: not an object, wrong version, or a non-array `ids` → fall back
to defaults. Unknown ids inside a valid array are dropped at resolve time rather
than at read time, so a tool that is temporarily absent from the catalogue does
not permanently delete itself from someone's favorites.

Public surface:

```ts
cpToolFavoriteIds(): readonly OristudioCpActionId[]   // stored order
isCpToolFavorite(id): boolean
toggleCpToolFavorite(id): void                        // append on add, filter on remove
moveCpToolFavorite(id, toIndex): void                 // clamped splice; no-op if unchanged
resetCpToolFavorites(): void                          // test seam
useCpToolFavorites(): { ids, isFavorite, toggle, move }
cpFavoriteToolActions(): readonly OristudioCpActionDefinition[]
```

`cpFavoriteToolActions()` resolves ids to definitions in **stored** order,
dropping unresolvable ones. Stored order, not catalogue order, is what makes the
drag possible at all: the order the user sees *is* the persisted array, so a
reorder is a splice and a write, with no separate ordering concept to keep in
sync.

`moveCpToolFavorite` fires on every pointer move during a drag, so it must be a
no-op when the index is unchanged — otherwise a stationary finger writes to
`localStorage` at pointer-event rate. The store compares before notifying, the
same identity check `publishCpToolSurface` uses.

Note this makes the **first reorder** a materializing edit too, exactly like the
first toggle: dragging while on the shipped defaults writes the explicit array.

Nothing in this module knows about phones. The phone-only decision lives at the
one render site.

### 3. What is favoritable

Command actions only. The line-type chips (M/V/E/A/U) are a crease *type*, not a
tool — they are already pinned at the top of the sheet as a segmented radiogroup
and are the thing favorites sit *below*. `kind === 'line-type'` gets no star.

Everything else on the rail gets one, including tools whose `uiStatus` is not
`ready`. A disabled row's star still works: starring an unfinished tool is
harmless and un-starring it later should not require it to become available
first.

### 4. Rendering in the sheet

`CpToolPickerSheet` renders, in order:

1. The Shift latch (unchanged).
2. The `line-type` group (unchanged — first by `order: 5`).
3. **Favorites**, a bespoke section, when non-empty.
4. Every remaining catalogue group, unchanged.

Favorites is *not* injected into `cpRailGroups()`. That function is a pure
catalogue read consumed by both the rail and the sheet, and making it depend on
mutable user state would both break its purity and hand the tablet rail a
Favorites group we are not shipping yet. It is also not a member of
`OristudioCpActionGroupId` — it is a view, not a catalogue group.

**Favorited tools keep their row in their home group too.** Favorites is a
shortcut, not a move; a tool that vanished from "Draw" when starred would make
the sheet's structure unstable. The same action therefore renders twice, so
React keys are namespaced (`fav:${action.id}` vs `${action.id}`) and both stars
read the same store, so toggling either updates both in one commit.

When the last favorite is removed the section unmounts entirely rather than
showing an empty-state row — the stars in the groups below are how you get it
back, they are visible, and a permanent instructional row would cost height on
the surface with the least of it.

To keep the sheet a composition site rather than a place behavior accumulates,
the star ships as its own component (`CpToolFavoriteToggle`) beside the store,
and the section as `CpToolPickerFavorites`. The sheet gains a section and a prop,
not logic. (`max-lines` is scoped to `src/components/panels/` and does not apply
here, but the decomposition rule in AGENTS.md still does.)

### 5. Long-press reorder — no library

**Recommendation: build it, in a reusable `useLongPressReorder` hook. Do not add
a drag library.**

There is no drag/DnD dependency in `apps/web` today — no dnd-kit, no react-dnd,
no framer-motion. So this is a genuine add-or-build decision, not a "we already
have one" shortcut. The reason to build is that the repo already contains both
halves of the gesture, and the case we need is the simplest one there is:

- **The drag half** is `DesignTabStrip`
  ([DesignTabStrip.tsx:233](apps/web/src/components/panels/DesignTabStrip.tsx:233)):
  ~40 lines of `pointerdown` → `window` `pointermove`/`pointerup`, hit-testing
  the live DOM and reordering as it goes rather than tracking drop zones. Its
  central insight transfers exactly — re-read both indices from the DOM on every
  move, because the row's own index changes mid-gesture, so comparing against
  the index it had at `pointerdown` makes every later move look like a move.
- **The long-press half** is `useTouchLabel`
  ([useTouchLabel.ts:72](apps/web/src/components/ui/useTouchLabel.ts:72)): a
  400ms timer with 10px slop, cancelled by movement, plus `consumeClick()` so
  the press that armed the gesture does not also fire the control's action, plus
  the `contextmenu` suppression Android Chrome needs on the same press.

What we need is those two composed. The list is a single vertical column of ≤ ~10
rows in one container — no cross-container drag, no grid, no virtualization, no
collision-detection strategy. That is precisely the case where dnd-kit's value
(the hard cases) does not apply and its costs do:

- **Bundle.** `@dnd-kit/core` + `/sortable` is roughly 13KB gzipped, added to the
  phone surface, to reorder six rows. This feature exists because the phone
  experience is cramped; paying for it in bytes is the wrong direction.
- **Tests.** The sheet's existing tests are raw `createRoot` + `act` with
  synthetic events. dnd-kit's sensors need real `PointerEvent`, layout, and
  `DOMRect` to activate, none of which jsdom gives us — testing it usually means
  writing a fake sensor, i.e. testing the harness. Pointer handlers we own are
  directly drivable from the tests already in that file.
- **Tauri.** This repo has already been bitten by native drag-and-drop
  (`dragDropEnabled` stays false so Tauri does not consume Dockview's panel
  drags). dnd-kit is pointer-based and would probably be fine — but "probably
  fine" against a known-hazardous area is worth avoiding when the alternative is
  ~100 lines we fully control.

The one thing a library would give us free is **keyboard reordering**. We should
not skip that, and the repo has already decided how: `DesignTabStrip` puts
"Move left / Move right" in its context menu and documents it as *the accessible
equivalent of the drag, not a convenience*. Favorites gets **Move up / Move
down** the same way, which suits a mobile-first surface better than drag
announcements would anyway.

The honest gap: dnd-kit also ships edge auto-scroll. Our favorites list sits at
the top of the sheet and is short, so a drag stays on screen; if someone stars
twenty tools it will not, and that is a follow-up rather than a launch blocker.

#### The scroll trap, which is the actual hard part

`.cp-tool-picker__body` is the scroll container (`overflow-y: auto`), and a
vertical drag on a vertically scrolling list *is* a scroll as far as the browser
is concerned. Two things that look like fixes and are not:

- Setting `touch-action: none` on the row **when the timer fires** is too late.
  `touch-action` is consulted when the gesture begins, so by the time we arm, the
  browser has already classified it as a pan.
- Setting `touch-action: none` on favorites rows **permanently** works, but makes
  the top of the sheet a dead zone you cannot scroll from — on the surface with
  the least room to spare.

The fix that does work: while armed, a **non-passive `touchmove` listener** that
calls `preventDefault()`. This is legitimate here precisely because the long
press requires stillness — 10px of slop cancels the timer — so when we arm, no
scroll has started yet, and cancelling a not-yet-started pan is honored. It must
be `addEventListener('touchmove', handler, { passive: false })` on the element or
window; React's `onTouchMove` goes through a passive root listener and cannot
cancel. The repo already does exactly this for `wheel` in four places
(`useViewportSurface`, `CreasePatternWebglCanvas`, `SimulatorViewport`,
`useWheelPassthrough`), so the shape is established.

#### `useLongPressReorder`

New file, placed for reuse rather than beside the sheet:
`apps/web/src/hooks/useLongPressReorder.ts`.

```ts
useLongPressReorder({
  itemAttribute: 'data-cp-favorite',  // how rows identify themselves in the DOM
  onReorder: (id, toIndex) => void,   // fired live, mid-drag
  onDragStateChange?: (id | null) => void,
}): { draggingId, handlers, consumeClick }
```

Activation splits on pointer type, which is what makes it desktop-ready rather
than phone-only:

- `pointerType === 'touch'` → long press (`TOUCH_LABEL_HOLD_MS`, cancelled by
  `TOUCH_LABEL_SLOP_PX` of movement). Both constants are exported from
  `useTouchLabel` already; import them rather than re-deriving, so a phone's two
  press-and-hold gestures never disagree about what a press is.
- mouse / pen → distance threshold, the `DRAG_THRESHOLD_PX = 4` that
  `DesignTabStrip` uses. Long-press on a mouse is bad UX, and the eventual
  desktop rail would inherit it if the hook only knew one activation.

`consumeClick()` is not optional: without it, holding a favorite to move it also
selects that tool and closes the sheet on release. Same failure `useTouchLabel`
documents ("holding Delete to find out what Delete does deletes"), same fix.

#### Gesture collisions, both real

1. **The star button sits inside the row that owns the long press.** The star
   therefore `stopPropagation()`s its own `pointerdown` — the pattern
   `DesignTabStrip`'s close button already uses for exactly this reason.
2. **`IconButton` carries `useTouchLabel` internally.** So the star must *not* be
   an `IconButton`; a bespoke button instead. That is the right call regardless:
   a hold-to-reveal-label on a star sitting directly beside a row that already
   spells the tool's name in plain text reveals nothing, and here it would race a
   second hold gesture 4px away.

Dragging outside the Favorites section does nothing — the hit test only considers
rows carrying the favorites attribute, so a drag that wanders into the groups
below clamps to the nearest end instead of doing something surprising like
un-favoriting.

Visual feedback is reorder-as-you-go, like the tab strip: the array permutes live
and the DOM follows, so there is no placeholder to manage. The dragged row lifts
(shadow + slight scale) via a `[data-dragging]` attribute, and that lift is
suppressed under `prefers-reduced-motion`, which the sheet's own entry animation
already honors.

### 6. Analytics

Two hand-placed events — no `MENU_ACTION_ID` reaches either, so the
`handleMenuAction` chokepoint cannot see them:

```
cp tool favorited          { action, favorited, source, favorite_count }
cp tool favorites reordered { source, favorite_count, moved_to_front, method }
```

- `action` — the action id. An enum drawn from a fixed shipped catalogue, the
  same class of value as `cp tool used`'s `operation`; no user content.
- `favorited` — `true` on star, `false` on un-star. One event for both
  directions, because the question is what the population converges on, and a
  star-only event cannot see the defaults being rejected.
- `source` — `'picker-sheet'` today. Present from the start so the rail and a
  future toolbar are distinguishable without a schema change.
- `favorite_count` — bucketed (`'0' | '1-3' | '4-6' | '7-12' | '13+'`) per the
  privacy contract's enums-and-bucketed-numbers rule.

On the reorder event:

- Fired **once per completed drag**, on release — never from `moveCpToolFavorite`,
  which runs at pointer-move rate and would emit dozens of events per gesture.
- `moved_to_front` — a boolean rather than the destination index, because the
  question worth answering is "does anyone promote a tool to the thumb position",
  and a raw index across a variable-length list answers nothing cleanly.
- No `method`. It was going to separate the drag from a Move up / Move down
  route; that route shipped and was then removed for the width it cost, so the
  property would be a constant. A second surface offering a second way earns it
  back.
- The permutation itself is never sent. It is high-cardinality and tells us
  nothing that `moved_to_front` plus the favorited set does not.

The numbers this has to answer are **whether the shipped defaults were right**
(un-star events against a default id are the direct signal; `cp tool used` for a
favorited tool before and after is the adoption signal) and **whether long-press
reorder is findable at all** — which now rests entirely on the count, the gesture
having no visible affordance and no sibling route (reorder events as a share of
sessions that opened the picker — `cp tool picker opened` already counts those).

### 7. Strings

New user-facing strings, authored inline as `t('<ns>:<key>', 'English default')`
in the `tools` namespace:

- `tools:cpToolPicker.favorites` — "Favorites" (section heading)
- `tools:cpToolPicker.addFavorite` — "Add {{tool}} to favorites"
- `tools:cpToolPicker.removeFavorite` — "Remove {{tool}} from favorites"
- `tools:cpToolPicker.moveFavoriteUp` — "Move {{tool}} up"
- `tools:cpToolPicker.moveFavoriteDown` — "Move {{tool}} down"

The star is icon-only, so its `aria-label` is the only name it has; interpolating
the localized tool name (`cpActionLabel`) is what stops 52 identically-labelled
buttons — and the same interpolation is what makes the two move commands name
which row they act on. Then `i18n:extract`, translate all 8 locales,
`i18n:stamp`, `i18n:check`.

## Affected Areas

| File | Change |
| --- | --- |
| `apps/web/src/cp-workspace/toolCatalog/cpToolFavorites.ts` | **New.** Defaults, store, persistence, move, resolve helper, hook. |
| `apps/web/src/cp-workspace/toolCatalog/cpToolFavorites.test.ts` | **New.** Defaults resolve; absent-key semantics; toggle/move/persist; malformed and unknown-id tolerance. |
| `apps/web/src/hooks/useLongPressReorder.ts` | **New.** Pointer-type-split activation, live DOM hit-test, non-passive `touchmove` cancel, `consumeClick`. |
| `apps/web/src/hooks/useLongPressReorder.test.ts` | **New.** Long press arms and distance cancels; mouse activates on distance; click consumed after a drag. |
| `apps/web/src/cp-workspace/toolCatalog/CpToolFavoriteToggle.tsx` | **New.** The star button; bespoke, not `IconButton`; surface-neutral. |
| `apps/web/src/cp-workspace/toolCatalog/CpToolPickerFavorites.tsx` | **New.** The Favorites section, owning the reorder wiring. |
| `apps/web/src/cp-workspace/toolCatalog/CpToolPickerSheet.tsx` | Row restructured to `<li>` + two sibling buttons; Favorites section mounted below line-type. |
| `apps/web/src/cp-workspace/toolCatalog/CpToolPickerSheet.test.tsx` | Row-shape assertions updated; favorites + reorder behavior covered. |
| `apps/web/src/lib/storage.ts` | Register `cpToolFavorites: 'cp-tool-favorites'`. |
| `apps/web/src/analytics/events.ts` | Add `cpToolFavorited` and `cpToolFavoritesReordered`, documented in the house style. |
| `apps/web/src/styles/theme.css` | `__row`, `__star`, `[data-dragging]`; move `[data-active]` styling from `__item` to `__row`. |
| `apps/web/public/locales/*/tools.json` | Generated + 8 translations. |
| `docs/analytics.md` | Document both new events. |

Deliberately untouched: `cpRailActions.ts`, `CpToolRail.tsx`,
`oristudioCpActions.ts`, `package.json`, and the CP kernel. Favorites is a UI
preference layered over the catalogue; nothing about the catalogue changes, and
no dependency is added.

## Decisions taken

- **No cap on favorites.** The store never refuses one. A surface with limited
  room takes the first N it can show.
- **`CreaseSelect` stays in the defaults**, per the reasoning above.
- **The defaults are a short explicit list**, not "the top N": plain Line was
  pulled after the first cut despite ranking third.
- **No drag library.** Built on the repo's own two precedents; rationale and the
  honest costs are in §5.

## Checklist

- [x] Register `cpToolFavorites` in `STORAGE_KEYS`
- [x] `cpToolFavorites.ts`: defaults, store, persistence, `moveCpToolFavorite`, `cpFavoriteToolActions`, hook
- [x] Store tests: defaults resolve via `cpActionById`; absent key → defaults; first toggle *and* first move materialize; malformed/unknown-id tolerance; add appends, remove filters, move clamps and no-ops when unchanged
- [x] `useLongPressReorder`: touch → long press (reusing `TOUCH_LABEL_HOLD_MS` / `TOUCH_LABEL_SLOP_PX`), mouse/pen → 4px distance, live DOM hit-test, `consumeClick`
- [x] Non-passive `touchmove` `preventDefault` while armed, so the sheet does not scroll under the drag
- [x] Hook tests: long press arms; movement before the timer cancels; mouse activates on distance not time; the click that ends a drag is consumed
- [x] `CpToolFavoriteToggle` — bespoke button (not `IconButton`, which carries `useTouchLabel`), interpolated `aria-label`, `aria-pressed`, `stopPropagation` on `pointerdown`
- [x] Restructure `CpToolPickerRow` to `<li>` + two sibling buttons; move `[data-active]` to the row
- [x] `CpToolPickerFavorites` section, mounted below the line-type group, hidden when empty
- [x] Namespaced React keys so a favorited tool can render in both places
- [~] Move up / Move down as the keyboard-reachable equivalent of the drag — **shipped, then removed.** On a 375px row the two chevrons cost 36px and pushed most descriptions onto a third line, to offer a keyboard route on a device with no keyboard. The drag is now the only one, so VoiceOver has none; see the note in `CpToolPickerFavorites` for the cheap fix if that changes.
- [x] CSS: `__row`, `__star`, `[data-dragging]` lift, touch-target sizing, active-bar relocation, `prefers-reduced-motion`
- [x] Both events in `ANALYTICS_EVENTS`; reorder fires once on release, never per pointer move; update `docs/analytics.md`
- [x] `i18n:extract`, translate 8 locales, `i18n:stamp`, `i18n:check`
- [x] Sheet tests: star toggles without selecting the tool; favorites section reflects the store; both copies of one action stay in sync; line-type chips have no star; a drag reorders and does not select
- [x] `npm run lint:web`, `npm run typecheck:web`, `npm run test:web`
- [x] Browser-verify on a phone viewport: star hit target does not swallow row taps, long press does not scroll the sheet, drag reorders and persists across reload, section order
- [ ] Verify the long press in the iOS Simulator — real WebKit, since the scroll-cancel path is the one thing a desktop browser's touch emulation does not faithfully reproduce
- [ ] Follow-up (separate change): favorites on the tablet/desktop `CpToolRail`
- [x] Pinned favorites in the bottom pill toolbar, replacing zoom/pan — **done here, not deferred.** Brought forward because the sheet alone left the bar carrying view controls nobody needs on a phone. Five, not six: the measurement is in `CP_TOOLBAR_FAVORITE_LIMIT`.
- [x] Zoom buttons dropped and Fit / pan / rotation / Insert image collapsed, via `phoneViewControls="collapsed"`
- [x] Folded models as a modal on the phone, sharing one `FoldedFigureControls` body with the dropdown
- [x] `opensDialog`, so the overflow menu's focus restore does not land after the modal's own
- [x] Helper text under the Favorites header, interpolating the same constant the bar slices by
- [ ] Follow-up (only if favorites lists get long): edge auto-scroll during a drag
