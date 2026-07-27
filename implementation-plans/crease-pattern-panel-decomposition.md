# Crease Pattern Panel — decomposition and drift guards

> Revised after the folded-figure work landed on `main`
> (`66afe29e`, PRs #135/#137/#138). That landing changed the diagnosis in a way
> worth reading before the phases: see **What the folded-figure landing changed**.

## Goal

Get `CreasePatternPanel.tsx` down to a **composition site** — mount surfaces,
wire them together, ~600 lines — by giving its stateful *binding layer* a home
beside the pure modules it drives. And put guards in place so it does not grow
back, because it has been cut once already and re-accumulated most of the
savings within a week.

The keyboard work in Phase 1 is not cosmetic: it removes a class of bug
(behaviour that silently dies when DOM focus moves) that has already shipped
twice and now has four separate surfaces that can trigger it.

## Current state

`apps/web/src/components/panels/CreasePatternPanel.tsx` on `main` — **3,810
lines**, of which one component holds ~2,900 (~400 JSX, ~2,500 logic) across
~207 hook calls: 66 `useCallback`, 45 store selectors, 36 `useMemo`, 25
`useState`, 19 `useRef`, 16 `useEffect`.

### Growth, corrected

| Date | Lines | |
|---|---|---|
| 2026-05-17 | 79 | created |
| 2026-07-13 | 7,640 | peak |
| 2026-07-15 | 2,825 | WebGL migration deletes the SVG surface |
| 2026-07-22 | 3,827 | +1,002 in 7 days (~143/day) |
| 2026-07-27 | 3,810 | −17 over the following 5 days |

An earlier draft of this plan fitted a line through the post-migration window and
projected a return to ~7.8k by mid-September. **That was wrong** — it was fitted
to the re-accumulation burst only. The actual shape is a burst (Jul 16–22)
followed by a **plateau**: the file has been flat, and briefly gone down, across
five days in which a substantial feature shipped.

So the problem is not runaway growth. It is that the file is **stuck at ~3,800
with no mechanism that makes it go down**, and the plateau is a property of the
last feature happening to be extractable rather than of anything structural. The
guards below are what turn a lucky plateau into a floor.

## What the folded-figure landing changed

The folded-figure feature (contextual toolbar, staleness/refold, per-figure
export) added ~1,900 lines across 12 new modules and moved the panel by **+38
lines net** (209 inserted, 171 deleted). Hook counts barely moved: `useMemo` +4,
store selectors +2, `useCallback` −1, and **zero new effects, refs, or state**.

That matters in three ways.

**1. The "random useEffect bandaids" fear is not what this landing shows.** It
added no effects at all. The effect problem is real but static and concentrated
in the keyboard trio (Phase 1). What actually grew is different, see (3).

**2. The pure-extraction half is being done well, unprompted.**
[`cp-workspace/foldedFigureActions.ts`](../apps/web/src/cp-workspace/foldedFigureActions.ts)
is a React-free, store-free action catalogue returning plain descriptors,
consumed by both the floating toolbar and the context menu, with 311 lines of
unit tests. Its own doc comment states the principle: *"This exists so the
floating toolbar and the right-click context menu cannot drift."* This is the
first instance of that pattern in the codebase and it is exactly right — Phase 0
should **codify it as a convention** rather than this plan inventing one.

**3. The growth mechanism today is binding-layer accretion, not logic.** With
the logic outside, what stays in the panel is the glue that binds it to the
store, and there is nowhere else for that to live:

| Added to the panel | Size |
|---|---|
| `foldedFigureActionDeps` — `useMemo` binding 8 verbs to store actions | ~60 lines, 10-entry dep array |
| `buildFoldedFigureMenuItems` — descriptor → `ContextMenuItem` adapter | ~45 lines |
| `staleFoldedFigureIds`, `selectedFoldedFigure`, `cpToolSelectionDistance` | 3 derived memos |

Every future concern that follows the (correct) action-catalogue pattern will
add its own deps-memo and its own adapter to the panel. **Extraction alone does
not shrink the panel — it converts logic into binding boilerplate.** Phases 2–5
have to take the binding layer too, or they will not move the number.

### Two new findings from the landing

**Floating-toolbar arbitration is a hand-maintained boolean chain.** There are
now four mutually exclusive floating toolbars, gated in JSX by:

```
{annotationsInteractive && selectedCpImage && !editingTextId && …}   CpImageInspector
{!editingTextId && !selectedCpImage && selectedFoldedFigure && …}    CpFoldedFigureToolbar
{!editingTextId && !selectedCpImage && !selectedFoldedFigure && …}   CpSelectionToolbar
```

plus the text toolbar inside `CpTextEditor`. A fifth toolbar means editing four
conditions and getting all four right. This is new since the last review and is
cheap to fix (Phase 2a).

**Focus restoration now depends on three different libraries behaving
differently.** The panel's keyboard is scoped to `containerRef` focus, and:

| Surface | Where its DOM lives | Restores focus on close? |
|---|---|---|
| Lexical text editor | inside the container | **No** — hence `refocusAfterTextEditRef` |
| Radix `DropdownMenu` (new folded toolbar) | portalled to `document.body`, **outside** the container | Yes, to the trigger |
| Plain unmount (toolbar delete) | inside | No |

The new Radix surface happens to be well-behaved, so nothing is broken today.
But the panel's keyboard now silently depends on the focus-restoration policy of
every third-party menu/editor library it composes, and a portalled surface is
invisible to a container-scoped listener entirely. This is a stronger argument
for Phase 1 than the one it replaces.

### Root causes (unchanged in substance)

**1. Keyboard routing is focus-coupled in the panel and focus-independent
everywhere else.** Escape is implemented twice:

| Where | Mechanism | Knows |
|---|---|---|
| [appKeyboard.ts:20](../apps/web/src/lib/appKeyboard.ts#L20) | `document` capture, focus-independent | how to deselect |
| [CreasePatternPanel.tsx](../apps/web/src/components/panels/CreasePatternPanel.tsx) (Escape effect) | `keydown` on `containerRef`, **only fires when focus is inside the panel** | hand tool → deselect → cancel tool |

Four panels grab focus on `pointerdown` solely to keep their keyboard alive, and
two have hand-written focus-restore mechanisms —
[BpTreePanel.tsx:566](../apps/web/src/components/panels/BpTreePanel.tsx#L566)
(`dismissSelection`) and `refocusAfterTextEditRef` in the CP panel, added by the
Escape fix that prompted this plan.

**2. Three predicates answer one question.**

| Predicate | Home | Extra over the base set |
|---|---|---|
| `isShortcutEditingTarget` | `keyboard/shortcutDispatcher.ts` | — (canonical) |
| `isEscapeConsumingTarget` | `panels/ViewportToolbar.tsx` | `[role=menu]` |
| `isViewportInteractiveTarget` | `panels/ViewportToolbar.tsx` | `[role=menu]`, `button` |

**3. The binding layer has no home** — see (3) above. This replaces the earlier
"concerns are interleaved" framing, which was a symptom rather than the cause.

### Module placement is drifting

The landing left ten folded-figure modules split across two directories with no
stated rule: `cp-workspace/foldedFigure{Actions,ActionIcons,State,Handles,StalenessDebug}.ts`
and `lib/foldedFigure{Staleness,Export,Svg}.ts` (+ `lib/foldedExport.ts`). Both
groups are CP-specific and engine-typed, so `lib/` vs `cp-workspace/` is not
currently separating anything. Worth a rule (Phase 0) and a consolidation while
Phase 3 is in there anyway.

## Resolved decisions

1. **Behaviour-preserving.** Every phase is a refactor. No behaviour change
   ships except the two bug fixes explicitly called out in Phase 1.
2. **Guards land first**, so the ratchet measures from today and every later
   phase visibly lowers a number.
3. **Stateful glue lives beside its pure modules**, as
   `cp-workspace/<concern>/use<Concern>.ts`. `src/hooks/` stays for genuinely
   cross-surface hooks (`useViewportSurface`).
4. **Phases are independently shippable**, ordered by payoff-per-risk. Phase 1
   first because it kills a bug class; Phase 4 last because it has the widest
   prop surface.
5. **No compatibility shims.** Delete the old path in the PR that adds the new.
6. **Do not re-litigate what main just did well.** `foldedFigureActions.ts` and
   `CpFoldedFigureToolbar.tsx` stay as they are; Phase 3 only takes the binding
   layer and fixes placement.

## Approach

### Phase 0 — Guards (do first)

**a. `AGENTS.md` nudge.** New subsection under **Web and Tauri**:

> ### Panel components
>
> Panels under `apps/web/src/components/panels/` are **composition sites**: they
> choose which surfaces mount and wire them together. They are not where
> behaviour accumulates.
>
> Before adding state, a ref, an effect, a memo, or an event listener to a
> panel, place it:
>
> | What you are adding | Where it goes |
> |---|---|
> | A keyboard shortcut, of any kind | `apps/web/src/keyboard/` — register it in the shortcut registry, implement it in the surface's executor. Never a `keydown` listener on the panel container. |
> | The set of verbs a thing offers (toolbar + context menu + menu bar) | A React-free, store-free action catalogue returning plain descriptors, next to that thing's modules. `cp-workspace/foldedFigureActions.ts` is the reference implementation. |
> | Store bindings for those verbs, or state/derived data for one concern | A `use*` hook beside that concern's modules — `cp-workspace/<concern>/use*.ts`. `hooks/useViewportSurface.ts` is the shape to copy. **A `useMemo` whose body is a bag of store callbacks belongs here, not in the panel.** |
> | Pure geometry/model logic | That concern's module, with unit tests. |
> | Presentation | A child component. |
>
> CP-specific modules live under `cp-workspace/<concern>/`. `src/lib/` is for
> code with no CP-workspace dependency, reusable by another surface.
>
> Three rules follow from this, and past bugs came from breaking the first two:
>
> - **No panel behaviour may depend on where DOM focus is.** A container-scoped
>   `keydown` listener goes dead the moment a text editor, floating toolbar, or
>   portalled menu takes focus, and portalled content it never sees at all. The
>   fix is never to hand focus back manually — it is to route the key through
>   the shortcut runtime, which is focus-independent.
> - **One predicate per question.** `isShortcutEditingTarget` in
>   `keyboard/shortcutDispatcher.ts` is the canonical "does this target own its
>   keystrokes" test. Do not write a near-copy in a component.
> - **Extracting logic is not enough.** If the extraction leaves a deps-memo and
>   a descriptor→UI adapter behind in the panel, the panel did not get smaller.
>   Take the binding with it.
>
> If a change genuinely fits no row above, the panel is missing an abstraction.
> Say so in the PR rather than adding another effect.

**b. `max-lines` ratchet** in `apps/web/eslint.config.js`, following the shape
the config already uses for `NO_DIRECT_STORAGE` (ban + message naming the
sanctioned home + scoped exemptions):

- `src/components/panels/**/*.tsx` (excluding tests): `max-lines: 800`, message
  pointing at the AGENTS.md section above.
- Per-file exemptions frozen at **today's** counts so existing panels can only
  shrink: CreasePatternPanel 3,830 (main's 3,810 + the 19-line Escape fix on
  this branch, rounded) · BpPackingPanel 2,310 · SimulatorPanel 2,005 ·
  DesignPanel 1,335 · BpTreePanel 1,005 · CpContextToolPanel 950.

Each later phase lowers the CreasePatternPanel number in the same commit.

**c. Deferred to Phase 1:** `no-restricted-syntax` banning
`addEventListener('keydown', …)` under `components/panels/**`, with named
exemptions for DesignPanel (space-to-pan), BpPackingPanel (arrow-nudge) and
BpTreePanel, each pointing at this plan.

### Phase 1 — Route CP viewport keys through the shortcut runtime

The load-bearing phase. Net negative lines. **`main` has not touched any file
this phase edits** (`CpTextEditor.tsx`, `ViewportToolbar.tsx`, `appKeyboard.ts`,
`keyboard/**`) — verified, and the branch merges clean.

- Add `viewport.cancel` and `viewport.deleteSelection` to `ViewportShortcutId`
  in [shortcuts.ts:9](../apps/web/src/keyboard/shortcuts.ts#L9), default chords
  `Escape` and `Delete`/`Backspace`. `normalizeKey` already maps `esc`→`escape`
  and `del`→`delete`, so no chord-parsing work.
- Move the bodies of the two container-scoped effects (the Escape ladder and the
  Delete-selected-canvas-object handler) into `handleViewportShortcut` as two
  new cases. Both effects are deleted.
- Delete `refocusAfterTextEditRef`, its effect, and its two assignment sites.
  Nothing depends on DOM focus any more — including the portalled Radix menus
  the folded-figure toolbar introduced.
- Delete `isEscapeConsumingTarget` and its test; the dispatcher already gates on
  `isShortcutEditingTarget`.
- Collapse the special-cased Escape block in
  [appKeyboard.ts:20-31](../apps/web/src/lib/appKeyboard.ts#L20) — Escape goes
  through the runtime like every other chord, removing the duplicate "Escape
  deselects" implementation.

Two bugs fixed as consequences, not as separate patches:

- Escape while focus sits on a **floating toolbar** (click Bold in the text
  toolbar, then Escape) currently does nothing. The executor sees `editingTextId`
  and exits the edit — closing the gap the Escape fix left open. Now applies to
  the folded-figure toolbar too.
- Escape immediately after picking a tool from the rail stops depending on the
  `isEscapeConsumingTarget` narrowing.

**Ordering risk, verified safe:** modals claim Escape with `window`-capture
listeners + `preventDefault()`, which run *before* the `document`-capture app
listener, and `handleShortcutKeyDown` bails on `event.defaultPrevented`. Radix
menus likewise handle Escape internally and stop it. Moving Escape into the
runtime does not steal it from either.

**Deviation, found during implementation.** `viewport.deleteSelection` was
dropped. `edit.delete` already owns Delete/Backspace at `global` scope, and
`handleShortcutKeyDown` resolves `viewport` first, so registering a viewport
Delete shadows crease deletion entirely — confirmed against the dispatcher, not
reasoned about. The panel's Delete listener is `window`-scoped and therefore not
focus-coupled, so it is not the bug class this phase targets; it folds into the
`edit.delete` menu action in Phase 2 alongside the annotation bindings it calls.

**Open decision:** registering `viewport.cancel` makes Escape appear in the
Settings shortcut editor as rebindable. Recommendation: allow it —
`classifyReservedKey` already returns `allowed` for it. Flagged in the PR so it
is a decision rather than a side effect.

### Phase 2 — `useCpAnnotations`, and toolbar arbitration

**2a (small, do it first):** replace the four-way boolean chain with a single
derived `activeFloatingSurface` value (`'text' | 'image' | 'folded' |
'selection' | null`) computed once in priority order. Adding a fifth toolbar then
means one new branch instead of four edited conditions. Cheap, and it stops the
next feature from making the chain worse.

**2b:** lift the annotation/canvas-object cluster to
`cp-workspace/annotations/useCpAnnotations.ts` — ~20 handlers, 6 refs, 2 state
vars, currently scattered across lines 1045–1210, 1494–1560, 1816, and
3045–3185 (on `main`). It owns its own undo-gesture protocol (`preGestureAnnotationsRef` /
`begin*` / `commit*`), which should not be readable-by-accident from unrelated
code. Take the bindings, not just the logic.

### Phase 3 — `useFoldedFigures` (binding layer only) + consolidation

The pure extraction is **done, and done well** — do not redo it. What moves:

- `foldedFigureActionDeps` (the ~60-line, 10-dep store-binding memo)
- `runFoldedFigureAction` and the gesture refs
  (`preGestureFoldedFiguresRef`, `preGestureActiveFoldedIdRef`,
  `foldedModelGestureScopeRef`)
- the derived memos `staleFoldedFigureIds`, `selectedFoldedFigure`,
  `activeFoldedFigure`, `generatedFoldedFigures`
- `foldCaseDraft` state + its sync effect, and the `handleFold*` callbacks
- `buildFoldedFigureMenuItems` — this is a **descriptor → `ContextMenuItem`
  adapter with no panel dependency**; it belongs next to `foldedFigureActions.ts`
  as a sibling renderer, exactly as `CpFoldedFigureToolbar` is the toolbar
  renderer. Extracting it also makes it unit-testable, which it is not today.

Also: move `FoldedFigureMenuButton` (259 lines, still inline in the panel at
[625–884](../apps/web/src/components/panels/CreasePatternPanel.tsx#L625)) and
the `FOLDED_*` option constants to their own files, and consolidate the ten
folded-figure modules under `cp-workspace/folded/` per the Phase 0 placement
rule. Nearly contiguous work — the cheapest phase by line count moved.

### Phase 4 — `useCpToolSession`

`cp-workspace/tools/useCpToolSession.ts`: `cpToolState`, `cpToolPoints`,
`cpToolPath`, `pendingLengthenLineId`, `pendingSquareBisectorLineIds`,
`cpToolDragRef`, `webglActiveTool`, the preview segment/point state, the new
`cpToolSelectionDistance` memo, `handleCpToolAction`, `buildCpCommandPayload`,
and the three entity-click handlers. Widest prop surface — deliberately last.

### Phase 5 — `useCpCamera`

`cp-workspace/useCpCamera.ts`: `zoomPercentRef`, `cameraCommandNonceRef`,
`overlaySettleTimerRef`, `viewSeededRef`, `sendWebglCameraCommand`,
`panToolActive`, and what remains of `handleViewportShortcut`. The WebGL
analogue of `useViewportSurface`; once both exist, consider unifying their
shared shape — do not force it.

### Phase 6 — Ratchet down, remove exemptions

Drop CreasePatternPanel's `max-lines` exemption and let it fall under the 800
default. Land the deferred `no-restricted-syntax` keydown ban with only the
non-CP panels exempted.

**Expected end state:** panel ≈ 500–700 lines (~400 JSX + composition).

## Affected Areas

- `apps/web/src/components/panels/CreasePatternPanel.tsx` — every phase
- `apps/web/src/components/panels/ViewportToolbar.tsx` — Phase 1 (predicate removal)
- `apps/web/src/keyboard/{shortcuts,shortcutRuntime}.ts` — Phase 1
- `apps/web/src/lib/appKeyboard.ts` — Phase 1
- `apps/web/src/cp-workspace/annotations/` — Phase 2
- `apps/web/src/cp-workspace/folded/` (new dir; absorbs `foldedFigure*` from
  `cp-workspace/` and `lib/`) — Phase 3
- `apps/web/src/cp-workspace/tools/` — Phase 4
- `apps/web/eslint.config.js` — Phases 0, 1, 6
- `AGENTS.md` — Phase 0
- Tests: `keyboard/*.test.ts` (Phase 1), new hook tests per phase, a new
  context-menu-adapter test (Phase 3), `ViewportToolbar.test.tsx` trimmed
  (Phase 1)

## Validation

Per phase: `npx tsc --noEmit` (run from `apps/web` — `npm run typecheck:web`
regenerates tracked wasm artifacts), `npm run lint:web`, `npm run test:web`. No
Rust, wasm, oracle, or desktop surface is touched by any phase; no user-facing
strings change, so no i18n work. Phase 3's module moves will churn import paths
widely — check `git status` for stray regenerated artifacts before committing.

Each phase also needs a **browser pass**; these are interaction refactors and
unit tests will not catch a dropped listener. Minimum per phase: tool activate /
cancel, Escape ladder (hand tool → deselect → cancel tool), Delete on each
selection kind, text annotation create/edit/exit by all four exits, folded-figure
select → contextual toolbar → each verb → context menu → submenu, staleness
badge + refold, camera zoom/fit/rotate.

## Risks / non-goals

- **Not a rewrite.** No state-management change, no reducer, no new store
  slices. If a phase starts wanting one, stop and re-plan.
- **Phase 4 is the risky one.** Its props feed the WebGL canvas; a dropped
  dependency shows up as a stale preview, not a type error. Take it alone.
- **Phase 3 collides with active feature work.** The folded-figure area is where
  development is currently happening — sequence it when that work is quiet, or
  accept the rebase cost. Phases 1 and 2 have no such overlap.
- **The other panels are out of scope.** BpPackingPanel (2,308) and
  SimulatorPanel (2,003) have the same shape and should get the same treatment
  later; this plan only freezes them so they cannot grow.
- **The guard is the deliverable, not the line count.** If phases 2–5 slip, the
  Phase 0 ratchet still holds the floor — which is the whole lesson of the
  post-migration re-accumulation.

## Checklist

- [x] Phase 0a — `AGENTS.md` "Panel components" section (incl. the action-catalogue and placement rules)
- [x] Phase 0b — `max-lines` ratchet + per-file freezes at today's counts
- [x] Phase 1 — `viewport.cancel` in the registry (no `viewport.deleteSelection`: it shadows `edit.delete`, see below)
- [x] Phase 1 — move Escape into `handleViewportShortcut`; delete the container `keydown` effect
- [x] Phase 1 — delete `refocusAfterTextEditRef` and `isEscapeConsumingTarget`
- [x] Phase 1 — collapse the Escape special case in `appKeyboard.ts`
- [x] Phase 1 — confirm Escape-from-floating-toolbar in the browser
- [x] Phase 1 — `no-restricted-syntax` keydown ban (CP still exempt for its Delete listener; Phase 2 removes it)
- [ ] Phase 2a — single `activeFloatingSurface` replaces the four-way toolbar chain
- [ ] Phase 2 — fold canvas-object Delete into the `edit.delete` menu action; drop the CP keydown exemption
- [ ] Phase 2b — `useCpAnnotations`; lower the CP `max-lines` freeze
- [ ] Phase 3 — `useFoldedFigures` binding layer + context-menu adapter extracted + `cp-workspace/folded/` consolidation; lower the freeze
- [ ] Phase 4 — `useCpToolSession`; lower the freeze
- [ ] Phase 5 — `useCpCamera`; lower the freeze
- [ ] Phase 6 — remove the CP exemption; panel under the 800 default
