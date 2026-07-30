# Interactive tutorial — learn-by-doing lessons

## Goal

Ship an in-app tutorial that teaches Ori Studio by making the user actually
draw. Each lesson is a short document — prose, an image, and a **target crease
pattern** — paired with a live editing canvas. The user copies the target using
the tool the lesson is teaching, and the app tells them when they've got it.

Concretely, the shape the author asked for:

```
┌ Lesson ─────────────┐┌ Crease Pattern ────────────────────────────┐
│ 2. Your first crease││                                            │
│                     ││        (real editor, real tool rail,       │
│ Pick the Segment    ││         empty paper — the user draws)      │
│ tool and draw the   ││                                            │
│ diagonal shown →    ││                                            │
│                     ││                                            │
│  ┌ Target ───────┐  ││                                            │
│  │      ╲        │  ││                                            │
│  │        ╲      │  ││                                            │
│  └───────────────┘  ││                                            │
│  ○ 0 of 1 creases   ││                                            │
└─────────────────────┘└────────────────────────────────────────────┘
```

This is roadmap **Phase 10: Help, Learning, And Release Polish** —
"Built-in tutorial flow" ([PRODUCT_ROADMAP.md:358](../PRODUCT_ROADMAP.md)) —
scoped to the CP editor first, with the Design (tree → optimize → CP) chapter
as later content on the same framework.

Non-goals for this plan: video, a hosted docs site, tutorial content for
localized languages beyond English source strings, and any authoring UI for
lessons (lessons are code + `.cp` files in the repo).

## Approach

### The one big decision: teach inside the real editor

The practice canvas is the **real `crease-pattern` panel** with the real tool
rail, not a simplified replica. Reasons: no second canvas stack to maintain
(the WebGL surface is ~2.8k lines), what the user learns is muscle memory for
the actual UI, and every tool works for free the day it lands.

### Document ownership: the tutorial gets its own document slot

`/learn` must not disturb `/edit`. You leave a half-finished pattern, take a
lesson, come back, and your document — with its history, selection, viewport,
folded figures, and unsaved-changes state — is exactly as you left it. `/edit`
keeps working normally the whole time: open, edit, save, export.

The apparent obstacle is that `oristudioCpDocument` is a single store field and
[oristudioCpRuntime.ts:36](../apps/web/src/store/workspaceStore/oristudioCpRuntime.ts)
holds a single kernel `handle`. But that turns out to be a thin constraint:

- The **worker API is already fully handle-parameterized** —
  `executeCommand(handle, …)`, `documentGeometry(handle)`, `exportCp(handle)`.
  Multiple live documents are a supported worker state.
- The module-level `handle` is **never exported**. All ~25 exported runtime
  functions read it internally. It is a single private seam, not a leak.

So we add a **document slot** rather than swapping documents:

```
type CpDocumentSlot = 'edit' | 'learn';
```

1. **Runtime.** `oristudioCpRuntime` keeps `slots: Record<CpDocumentSlot,
   { handle, source, loadSerial }>` plus an `activeSlot`. The ~25 internal
   `handle` reads become `current().handle` — mechanical, and no consumer
   outside the module changes. One new export: `switchCpDocumentSlot(slot)`.
   Both kernel handles stay allocated simultaneously; nothing is freed or
   re-parsed on switch.
2. **Store.** A new `cpDocumentSlots.ts` owns `CP_SLOT_STORE_FIELDS` — the ~20
   CP-scoped `WorkspaceState` fields (document, lineage, history past/future,
   selection, revision, folded figures, annotations, viewport, active tool,
   extensions, …) — with `captureCpSlotState()` / `installCpSlotState(bundle)`.
   Inactive bundles live in a module map, not in the store. Swapping is a
   `setState` of plain objects already in memory; there is **no serialization
   round-trip**.
3. **Entry point.** `enterCpDocumentSlot(slot)`: capture the current bundle →
   switch the runtime slot → install the target bundle, or install nothing when
   the slot is empty and let the surface self-provision (which is the existing
   rule — surfaces provision, routes only express intent).
4. **Routes call it.** `/edit` → `enterCpDocumentSlot('edit')`; `/learn/*` →
   `enterCpDocumentSlot('learn')`. Lesson-to-lesson switches load a new document
   *within* the learn slot and never touch the edit slot.

Because `oristudioCpViewport` and the per-slot `loadSerial` travel in the
bundle, returning to `/edit` restores the user's exact pan/zoom instead of
re-fitting — the switch is visually a no-op.

**The maintenance risk is field drift**: someone adds a CP-scoped store field
and forgets the slot list, and it silently bleeds between surfaces. Guard it
with a test asserting the keys of `freshEditableCpState`
([freshCreasePattern.ts](../apps/web/src/store/workspaceStore/freshCreasePattern.ts))
are a subset of `CP_SLOT_STORE_FIELDS`, so the two lists cannot diverge quietly.

**File-level commands are masked in the learn context.** `dirty`, the project
source, and Save/Save As live in `projectSlice` and are *not* slot-scoped —
saving from inside a lesson must never overwrite the user's file. The learn
editing context disables Save / Save As / Open / New. Export stays enabled (it
reads the active kernel handle, and "export your practice pattern" is useful).

No discard prompt is needed anywhere in this design, because nothing is
discarded.

Target CPs are loaded through a **transient third handle** — `loadCp(text)` →
`documentGeometry(handle)` → `freeDocument(handle)` on the same worker
([oristudioCpWorker.ts:137](../apps/web/src/workers/oristudioCpWorker.ts)) —
which the worker API already supports. Result is memoized per lesson. We do
**not** hand-parse `.cp` in TypeScript; the engine stays the only reader of the
format.

### A new `learn` workspace and route

Add a fourth workspace alongside `design` / `edit` / `simulate`:

| Route | Shows |
|---|---|
| `/learn` | Lesson index — chapters, per-lesson completion, "Resume" |
| `/learn/:lessonId` | Lesson panel + practice canvas |

Follows the routing architecture already in place: URL is the source of truth,
`WorkspaceRoute` reconciles store→route, provisioning is presence-guarded and
happens in the surface, not in a loader (see
[workspace-routing.md](workspace-routing.md) and the startup-provisioning rule).
`applyLearnLayout` adds a `lesson` panel (left, 400px) and the existing
headerless `crease-pattern` panel — a ~15-line addition to
[layoutStore.ts:167](../apps/web/src/store/layoutStore.ts) mirroring
`applyEditLayout`. The learn workspace reports the **CP editing context** so
CP menus, toolbar, and shortcuts stay live
([editingContext.ts](../apps/web/src/workspaces/editingContext.ts)).

### Lesson content model

Lessons are typed data modules — the same pattern as
[oristudioCpActions.ts](../apps/web/src/lib/oristudioCpActions.ts), with English
inline as the source of truth and a **generated `tutorial` i18n namespace**
mirroring [cpVocab.ts](../apps/web/src/i18n/cpVocab.ts) and kept honest by a
`tutorialVocab.gen.test.ts` sync test. That keeps prose translatable by the
existing `i18n:extract` / `i18n:check` gate instead of stranding it in Markdown
outside the pipeline. Its own namespace also means the (large) tutorial catalog
is lazy-loaded and never weighs on other surfaces.

**Decision: rich explanatory prose, fully translated.** Lessons teach origami
concepts, not just tool mechanics, so steps carry real paragraphs rather than
one-line captions. Consequences to plan around:

- Expect **300–600 new English keys across all 8 locales** — roughly doubling
  the app's ~1,771-key localized surface. `i18n:check` fails CI on any missing
  or stale translation, so this is not deferrable work.
- **Translate per chapter, never in one batch at the end.** Each chapter lands
  with its own translations so the gate stays green incrementally.
- **Settle English before translating.** Rewording English marks every
  translation stale ([docs/i18n.md](../apps/web/docs/i18n.md)), so each chapter
  gets an explicit English-copy review with the author *before* the translation
  pass — otherwise every lesson gets translated twice.
- Where a step is genuinely about tool mechanics, still render from the
  **already-translated** `cpVocab` instructions (67 of 129 CP actions carry
  `intro`/`steps`/`notes` in all 8 locales). Free, and it keeps the tutorial in
  step with tool changes. Authored prose is for the *concepts* around them.
- Rich prose means inline emphasis and links: use `<Trans>` and preserve child
  tag indices identically across locales.

```ts
type LessonStep =
  | { kind: 'prose';  body: readonly string[]; image?: LessonImage }
  | { kind: 'draw';   body: readonly string[]; target: LessonTarget; check: CheckSpec;
                      teaches: OristudioCpActionId }        // tool the step is about
  | { kind: 'action'; body: readonly string[]; expect: StatePredicateId }  // e.g. a folded figure exists
  | { kind: 'explore'; body: readonly string[] };            // free play, manual Done

interface Lesson {
  id: string; chapterId: string; title: string; blurb: string;
  /** `.cp` imported ?raw — the starting document for the practice canvas. */
  startCp: string;
  steps: readonly LessonStep[];
}
```

`prose` and `explore` advance on a Next button. `draw` and `action` advance when
their check passes (with a "Skip step" escape hatch so nobody gets stuck).

### The comparison engine (the real engineering)

Naive segment-set equality fails immediately: a user's single long crease and a
target's two collinear halves are the same pattern, endpoints land within
snap-tolerance rather than exactly, and endpoint order/direction is arbitrary.
`apps/web/src/tutorial/check/` owns this, as pure functions over the decoded
geometry snapshot (`OristudioCpLineSegment[]`, [oristudioCpTypes.ts:35](../apps/web/src/engine/oristudioCpTypes.ts)):

1. **Filter** — drop the paper-boundary edges (segments on the square's border)
   unless the lesson opts in; include `aux_line_segments` only when the lesson
   is teaching auxiliary lines.
2. **Quantize** endpoints to a tolerance (default grid-relative, ~1/64 paper).
3. **Merge collinear runs** — group by infinite-line key (normalized direction +
   signed offset), sort by projection along the direction, union overlapping and
   touching intervals of the same assignment into maximal chains.
4. **Key** each chain canonically: `assignment|p_lo|p_hi`, endpoints ordered
   lexicographically.
5. **Diff** the two multisets → `{ matched, missing, extra, wrongAssignment }`.

Match modes on `CheckSpec`:

- `exact` — no missing, no extra.
- `subset` — no missing; extras tolerated (good for "add a crease to this CP").
- `ignoreAssignment` — key drops mountain/valley so a right-place/wrong-type
  crease reports as `wrongAssignment` and the UI can say *"right line, wrong
  fold type"* instead of a bare failure.
- `allowSymmetry: 'none' | 'd4'` — match the target under the 8 square
  symmetries, for lessons where "a diagonal" means either diagonal. Implemented
  as best-of-8 over transformed targets.

This is unit-testable with zero UI and zero engine, and it's where most of the
test effort goes.

### Live checking

The lesson panel subscribes to `oristudioCpRevision` and, on change (debounced
~150ms), pulls the compact geometry transport and re-runs the check. Per the
compact-transport work this is ~4ms, so it is safe on the edit path; it must
**not** call `snapshot()` or anything that round-trips a full document. Feedback
renders as a progress line ("2 of 3 creases — 1 missing, 1 extra") plus missing
segments highlighted in the target preview.

### Target preview

`TargetCpPreview` renders a decoded geometry snapshot as a **static SVG** —
lines colored by assignment from the existing theme tokens, plus a highlight
class for missing/extra segments. Static SVG rather than a second WebGL context:
it's a few dozen lines, prints and scales, and there may be several previews
on screen (index thumbnails). Reuses
[cssColor.ts](../apps/web/src/cp-workspace/renderer/cssColor.ts) for assignment
colors so previews and canvas cannot drift.

A **ghost overlay** — the target drawn faintly on the practice canvas itself —
is the single highest-value polish item, but it needs a renderer program, so it
is deliberately deferred to Phase 7.

### Authoring targets

Author target `.cp` files **in the app**: draw the pattern, File › Export `.cp`,
drop the file in `apps/web/src/tutorial/targets/`. `.cp` is small and diffable,
so targets review cleanly. A test asserts every `target`/`startCp` referenced by
a lesson parses and yields ≥1 segment, so a bad export fails CI rather than the
user's lesson.

### Curriculum

| Chapter | Lessons | Teaches |
|---|---|---|
| 1. Basics | Canvas & navigation · Your first crease · Mountain, valley, auxiliary · Select, undo, delete · Snapping and the grid | `draw` group, line types, selection |
| 2. Drawing | Segment · Point-sequence tools · Auxiliary lines · Polygon/box tools | rest of the `draw` group |
| 3. Construct by geometry | Perpendicular · Angle bisector · Axioms 5 & 7 · Divide | `construct` group |
| 4. Transform | Copy/paste · Reflect · Rotate · Operation frame | `transform` group |
| 5. Check and fix | Read the diagnostics · Repair a deliberately-broken CP | `check-fix` group, CAMV |
| 6. Folded form | Fold estimate · Read the folded figure · Send to Simulate | `folding` group + Simulate |
| 7. Design *(later)* | Tree → optimize → CP · Box-pleated flap packing | Design workspace |

Chapters 1–2 ship with the framework. 3–7 are content-only additions on top of
it — new data modules and `.cp` files, no new machinery — and chapter 7 is
explicitly out of scope for this plan.

### Entry points and progress

- Help menu → "Tutorial" (currently the Help menu has only `help.about`,
  [menuDefinition.ts:257](../apps/web/src/menus/menuDefinition.ts)).
- A card on the start screen.
- Progress (completed lesson ids, last-visited lesson) persisted through the
  central storage module with a new `tutorialProgress` key in `STORAGE_KEYS`
  ([storage.ts:20](../apps/web/src/lib/storage.ts)) — no hand-rolled
  `localStorage`.

### Risk: does this make the Edit workspace harder to maintain?

This is the main design objection, so it gets a direct answer. Two findings cut
the risk, three name it precisely, and there is a defined bail-out.

**Why the risk is lower than it looks.**

1. **Edit already tolerates having its document replaced underneath it.** File ›
   Open, File › New, and import all swap `oristudioCpDocument` today, and the
   code is written for it. `scheduleOristudioCamvRefresh` captures the document
   by reference and discards its result if the reference changed
   ([projectSlice.ts:1788](../apps/web/src/store/workspaceStore/slices/projectSlice.ts)) —
   the comment says so explicitly. A slot switch is the same event these guards
   already handle. Slots reuse an existing hazard class rather than adding one.
2. **The CP panel is destroyed on every workspace switch.** `activateWorkspace`
   does `dockviewApi.clear()` and rebuilds from JSON
   ([layoutStore.ts:228](../apps/web/src/store/layoutStore.ts)), so
   `CreasePatternPanel` fully unmounts on `/edit` ↔ `/learn`. Its local tool
   machine, WebGL context, camera, and refs go with it — nothing bleeds across
   slots through the component. This is already what `edit` ↔ `design` does.

### Spike results (executed — see `git diff apps/web/src/store/workspaceStore/types.ts`)

Two questions were spiked against the real tree rather than argued.

**Spike 1 — can the guard be structural instead of a synced list? Yes, and it is
nearly free.**

`WorkspaceState` is already an intersection of slice types, and TypeScript
interface extension is **structurally flat** — a field declared in a base
interface is still read as `state.oristudioCpDocument`. So the per-document
fields can be regrouped into one interface *without touching a single read site*.
Measured: ~1,300 references across 81 files, **zero changed**.

The regrouping introduces:

- `CpDocumentScopedState` — the one declaration site for every per-document
  field. `CreasePatternSliceState` turns out to be **wholly** document-scoped, so
  it is included whole; the nine CP fields stranded in `ProjectSliceState` are
  declared in `CpDocumentOwnedByProjectSlice` and extended back in, which avoids
  moving initial values between slice creators. This type *is* the slot bundle
  type, so capture/install are checked end to end.
- `CP_DOCUMENT_SCOPED_KEYS: Record<keyof CpDocumentScopedState, true>` — a
  **total** key map. `Record<K, true>` is exhaustive both ways: omitting a key is
  a missing-property error, adding an unknown one is an excess-property error.
- `CpFieldScopingIsExhaustive` — asserts no `oristudioCp*`-prefixed field is
  declared on `WorkspaceState` outside the group.

Verified green on the spike: `tsc --noEmit` clean, `lint:web` clean, 841/841
tests pass. Then both guards were verified to actually **fire**:

| Mistake introduced | Result |
|---|---|
| Add a field to the doc-scoped group, don't wire it | `TS2741: Property 'oristudioCpNewlyAddedThing' is missing … but required in type 'Record<keyof CpDocumentScopedState, true>'` (plus a second error from the slice creator's missing initial value) |
| Declare `oristudioCpStrayField` on `EditingSliceState` | `TS2322: … not assignable to type '["CP field declared outside CpDocumentScopedState:", "oristudioCpStrayField"]'` — the error names the offending field |

This replaces the field-list test entirely. There is no list to keep in sync;
the compiler refuses the mistake. Residual judgment: a *new* field's author still
chooses which interface to declare it in — but that is now one visible, well-named
decision at the declaration site, and the prefix assertion catches the
convention-following majority automatically.

**Spike 2 — the singleton audit. Smaller and more uniform than feared.**

Swept `store/`, `slices/`, and `cp-workspace/` for module- and closure-level
mutable state. Nine hits; classified:

| State | Verdict |
|---|---|
| `ensureEditInFlight` ([creasePatternSlice.ts:83](../apps/web/src/store/workspaceStore/slices/creasePatternSlice.ts)) | **Needs slot-awareness** — one global provisioning promise |
| `foldArtifactPromise` / `…Revision` ([:94](../apps/web/src/store/workspaceStore/slices/creasePatternSlice.ts)) | **Needs slot-awareness** — cached on revision alone; per-slot revisions both start at 0 |
| `foldedFigureRequestSequence`, `modelRequestSequence` ([:96](../apps/web/src/store/workspaceStore/slices/creasePatternSlice.ts)) | **Needs slot-awareness** — staleness sequences keyed by figure id |
| `camvRefreshTimer` ([projectSlice.ts:214](../apps/web/src/store/workspaceStore/slices/projectSlice.ts)) | Benign (the callback re-reads the document *after* the switch) but should be cleared on switch |
| `foldedFigureHandles` counts + `freeHandle` | **Safe** — keyed by kernel handle, which is globally unique across documents |
| `localGeometryCache` (`cpFoldedToScene.ts:253`) | **Safe** — `WeakMap` keyed by object identity |
| `cpOverlayViewStore.current` | **Likely safe** — the panel unmounts on workspace switch and repopulates it; confirm |
| `TRANSPARENT_SOURCE_TYPES`, `clipboardSlice` local `nodeIds` | False positives (constants / function-locals) |

The important result is not the count but that **every genuine hit is the same
pattern**: in-flight async request tracking that isn't slot-aware. One primitive
fixes all of them — a slot generation counter, captured at request start and
compared before applying the result. That is the discipline
`scheduleOristudioCamvRefresh` already uses with reference identity
([projectSlice.ts:1788](../apps/web/src/store/workspaceStore/slices/projectSlice.ts)).
The risk collapses from "N scattered unknowns" to "one named pattern, one shared
guard, four call sites."

**The one risk no type can cover.** Someone later adds a *new* module-level
cache keyed to "the current document." Mitigation stays behavioral: a round-trip
test that opens a document in the edit slot, switches to learn, mutates heavily
(draw, undo, fold, select), switches back, and asserts the edit bundle is
deep-equal to the capture — it catches a leak wherever it lives.

**The invariant that keeps the blast radius at zero.** `enterCpDocumentSlot` is
called **only from route effects**. Nothing in the Edit workspace — no panel, no
slice, no command — ever mentions a slot. If a reviewer sees `slot` inside the
editor, the abstraction has leaked and should be pushed back to the route. The
ongoing maintenance tax is therefore one category ("is this CP state per-document
or global?") that the compiler asks about, rather than a second code path
through the editor.

**Bail-out.** If the Phase 1a audit turns up substantially more than the four
singletons above, or any that resist slot-keying cleanly, stop and switch to the
fallback: give the tutorial its own store and its own handle, rendering the
canvas component parameterized by source rather than reading the workspace store.
That is more code and loses some editor fidelity, but its blast radius on Edit is
zero. **Decide at the end of Phase 1a with the audit in hand** — not now, and not
after the tutorial UI is built on top.

### Decisions taken (override if you disagree — each is cheap to flip now)

1. **All four fields the spike left open stay global — corrected.** I first
   assumed they were document-scoped from their names; checking actual usage
   flipped three of them:
   - `toolMode` is the **design** tool mode (`'select' | 'node' | 'edge' |
     'symmetry'`), read only by `DesignPanel`. The CP canvas's `toolMode` is an
     unrelated local. Global.
   - `symmetryAuthoringPairs` is **tree** symmetry authoring, also `DesignPanel`
     only. Global.
   - `projectLoadId` is a project-wide load counter read by **both** the CP and
     Design panels; slot-scoping it would desync `DesignPanel`'s fit logic. Global.
   - `dirty` — **corrected twice.** First kept global, on the reasoning that a
     design edit made under the learn slot would be restored away. Decision 3
     (below) removes that case entirely by pinning `/design` to the edit slot, and
     browser testing then showed keeping it global was actively wrong: suppressing
     it for the tutorial *destroyed* the editor's copy, so a round trip through a
     lesson silently reported the user's unsaved work as saved. It is now
     **slot-scoped**, and the suppression only clears the ephemeral slot's copy.

   So the doc-scoped group is exactly what the spike produced. **Lesson: classify
   by usage, not by name.**
2. **The learn slot additionally suppresses dirty-marking.** A tutorial pattern
   can never be saved, so showing "unsaved changes" during a lesson would be a
   lie. Enforced as a single store-level invariant (clear `dirty` whenever an
   ephemeral slot sets it) rather than a predicate repeated at the ~30 places that
   set the flag — those span two slices, and a repeated check would rot the first
   time someone added a thirty-first. Because `dirty` is slot-scoped, clearing it
   touches only the lesson's copy.
3. **Camera framing re-fits on slot switch; view *options* are restored.**
   `oristudioCpViewport` (grid, display toggles) is slot-scoped and comes back.
   Pan/zoom does not: the CP panel unmounts on every workspace switch and re-fits
   on mount, which is already what `edit` ↔ `design` does today. An earlier draft
   of this plan claimed exact pan/zoom restoration — that was wrong.
3. **`/edit` and `/design` assert the edit slot; `/learn/*` asserts learn;
   `/simulate` keeps whichever is current.** `/simulate` must keep it so the
   Chapter 6 "send to Simulate" lesson simulates the *lesson's* pattern.

   `/design` asserting the edit slot is what makes the dirty rule (below) safe:
   design and tree edits *should* mark the project dirty, and if `/design` kept
   an ephemeral slot they would be suppressed. With this rule the only surfaces
   reachable under the learn slot are `/learn` and `/simulate`, neither of which
   can edit the tree or a BP design — so "ephemeral slot ⇒ nothing marks the
   project dirty" holds unconditionally.
4. **Target `.cp` files are hand-authorable.** The format is one segment per
   line, so lesson targets can be written directly and reviewed as diffs; they
   still load through the engine, never a TypeScript parser. Visual confirmation
   that a target *looks* right is a browser-verification item.
5. **No first-run auto-launch.** The tutorial is discoverable from Help and the
   start screen but never interrupts. Revisit after the first chapter exists.

### Known friction to resolve during the build

- **Tool preselection is already available.** The transitional tool machine is
  `useState`-local to `CreasePatternPanel`, but arming a tool is a store action:
  `requestOristudioCpAction(operationId)` pushes an id-stamped request the panel
  consumes ([creasePatternSlice.ts:715](../apps/web/src/store/workspaceStore/slices/creasePatternSlice.ts),
  consumed at [CreasePatternPanel.tsx:2228](../apps/web/src/components/panels/CreasePatternPanel.tsx)),
  and the menu already drives tools this way. A `draw` step's `teaches` field can
  arm its tool on entry, so this is Phase 1, not deferred polish. Open question
  is only *whether* to auto-arm or just highlight the rail button — decide from
  feel during Phase 3.
- **Desktop parity.** Learn routes must work under the Tauri memory router and
  the native engine client. The native client implements the same worker API, so
  multi-handle slots should behave identically — verify, don't assume.
- **Slot lifetime.** Two live documents means two resident kernel documents. A
  tutorial CP is tiny, but the *user's* Edit document may be large; it stays
  resident either way, so this is not a new cost. Still worth confirming under
  the desktop WKWebView memory ceiling with a big `.osf` open in the edit slot.

## Affected Areas

New:

- `apps/web/src/tutorial/types.ts` — `Lesson`, `LessonStep`, `CheckSpec`.
- `apps/web/src/tutorial/lessons/{index,basics,drawing,…}.ts` — content.
- `apps/web/src/tutorial/targets/*.cp` — target and starting patterns.
- `apps/web/src/tutorial/check/{canonicalize,compare,symmetry}.ts` + tests.
- `apps/web/src/tutorial/runtime/{targetGeometry,useLessonCheck}.ts`.
- `apps/web/src/store/workspaceStore/cpDocumentSlots.ts` + test — slot field
  list, capture/install, `enterCpDocumentSlot`.
- `apps/web/src/components/panels/LessonPanel.tsx`, `LessonIndexPanel.tsx`.
- `apps/web/src/components/tutorial/TargetCpPreview.tsx`.
- `apps/web/src/store/tutorialStore.ts`.
- `apps/web/src/i18n/tutorialVocab.ts` + `tutorialVocab.gen.test.ts`.
- `apps/web/src/assets/tutorial/*` — lesson images.

Modified:

- `apps/web/src/workspaces/workspaces.ts` — add `learn` to `WorkspaceId`,
  `WORKSPACE_DEFINITIONS`, and `WORKSPACE_BY_PANEL_ID`; `editingContext.ts` —
  report the CP context for `learn`.
- `apps/web/src/store/layoutStore.ts` — `applyLearnLayout`.
- `apps/web/src/routing/{paths,appRouter}.tsx` — `/learn`, `/learn/:lessonId`.
- `apps/web/src/components/panels/PanelComponents.tsx` — register the `lesson`
  and `lesson-index` panel components.
- `apps/web/src/store/workspaceStore/oristudioCpRuntime.ts` — slot-keyed
  `handle` / `currentSource` / `documentLoadSerial`; export
  `switchCpDocumentSlot`. Mechanical, contained, no consumer changes.
- `apps/web/src/menus/menuDefinition.ts` — Help › Tutorial; mask Save / Save As
  / Open / New in the learn context.
- `apps/web/src/components/StartScreen.tsx` — tutorial card.
- `apps/web/src/lib/storage.ts` — `tutorialProgress` key.

Not touched: `crates/**` (no engine change — the tutorial is entirely a
consumer of the existing CP worker API), `apps/tauri/**` (memory router already
handles new routes).

## Checklist

### Phase 0 — Spike the risky bits ✅

- [x] **Two simultaneously live CP handles are safe. Gate cleared.**
      `CpSession` is a handle arena (`documents: Vec<Option<CreasePatternDocument>>`,
      [session.rs:203](../crates/oristudio-cp/src/session.rs)) with no shared
      "current document" state, so independence is structural. Asserted by
      `concurrent_handles_are_isolated`: two live documents, edit one, the other
      stays byte-identical on `export_cp`; a transient third handle is loaded,
      read, and freed without disturbing either. **Both surfaces are covered by
      that one test** — wasm holds a `thread_local` `CpSession`
      ([oristudio-cp-wasm/src/lib.rs:23](../crates/oristudio-cp-wasm/src/lib.rs))
      and desktop holds `Arc<Mutex<CpSession>>`
      ([cp_engine.rs:34](../apps/tauri/src-tauri/src/cp_engine.rs)) — the same type.
- [x] **Creases are not auto-split at intersections.**
      `operations::transform::insert_line_segments` appends segments and never
      divides ([transform.rs:371](../crates/oristudio-cp/src/operations/transform.rs)).
      Canonicalization therefore must not *expect* splitting — and because it
      merges collinear runs anyway, split and whole forms compare equal either
      way. No change to the Phase 2 design.
- [x] Target `.cp` authoring confirmed viable: the format is one segment per
      line (`<type> <x1> <y1> <x2> <y2>`), hand-writable and diff-readable.

### Phase 1a — Document slots (lands before any tutorial UI)

- [x] **Spike: structural scoping.** `CpDocumentScopedState` + total key map +
      prefix assertion; zero read-site changes; both guards verified to fire.
- [x] **Spike: singleton audit.** Nine hits classified; every genuine one is the
      same in-flight-async pattern.
- [x] `types.ts` regrouping: `CpDocumentScopedState`, `CP_DOCUMENT_SCOPED_KEYS`,
      `CpFieldScopingIsExhaustive`, `CpDocumentSlotId`.
- [x] Classified `projectLoadId`, `toolMode`, `symmetryAuthoringPairs`, `dirty`
      by usage — all four stay **global** (see Decisions).
- [x] `activeSlotTracksProjectDirty()` + a store-level invariant that clears
      `dirty` when an ephemeral slot sets it (one place, not ~30 call sites).
- [x] Slot generation counter applied at all four in-flight sites
      (`ensureEditInFlight`, `foldArtifactPromise` → now keyed
      `${generation}:${revision}`, folded-figure model requests, `camvRefreshTimer`).
- [ ] Confirm `cpOverlayViewStore.current` repopulates on panel remount
      (browser check — deferred to Phase 1b when a lesson can actually mount).
- [x] Slot-keyed `handle` / `source` inside `oristudioCpRuntime` (`slots`,
      `activeSlot`, `switchCpDocumentSlot`, `releaseCpDocumentSlot`).
      `documentLoadSerial` stays global — it is a monotonic change-detection
      counter, so sharing it across slots is correct.
- [x] `cpDocumentSlots.ts`: capture/install typed as `CpDocumentScopedState`,
      `enterCpDocumentSlot`, pristine bundle captured from the store at init
      (not restated) so slice initial values cannot drift.
- [x] Round-trip isolation test (7 cases), verified to fail when parking is
      removed.
- [ ] `/edit` enters the `edit` slot; behavior on `/edit` is unchanged with only
      one slot ever used (regression-check open, edit, undo, save, export).
- [ ] Mask Save / Save As / Open / New in the learn editing context.
- [ ] Enforce the invariant: `enterCpDocumentSlot` referenced only by route
      effects; no `slot` mention inside panels, slices, or commands.

### Phase 1b + 2 — Tutorial framework and comparison engine

Built together: the lesson panel is only meaningful against a real checker, so
writing it against a stub would have been throwaway work.

- [x] `Lesson` / `LessonStep` / `LessonCheckSpec` types.
- [x] `tutorialStore` — active lesson, step index, per-step check result,
      progress persisted via `lib/storage`.
- [x] `learn` workspace id (hidden from the rail) + CP editing context.
- [x] `applyLearnLayout`; `lesson` panel registered and mapped.
- [x] `/learn` and `/learn/:lessonId` routes; unknown `lessonId` → `/learn`.
- [x] `/learn/*` enters the `learn` slot; the panel provisions into it.
- [x] A `draw` step arms its `teaches` tool via `requestOristudioCpAction`.
- [x] `targetGeometry` loader with per-target memoization and handle cleanup.
- [x] `TargetCpPreview` static SVG using the `--fold-*` theme tokens.
- [x] `LessonPanel`: prose, image, target, feedback, Next/Back/Skip; shows the
      lesson index when no lesson is open.
- [x] End-to-end verified in the browser: drew the diagonal, the check flipped
      to satisfied, Next enabled.

### Phase 2 — Comparison engine

- [x] `canonicalize.ts` + tests incl. split-vs-whole equivalence.
- [x] `compare.ts`: diff → `matched / missing / extra / wrongAssignment`.
- [x] Match modes `exact`, `subset`, `ignoreAssignment`.
- [x] `symmetry.ts`: best-of-8 D4 matching, opt-in per check.
- [x] `useLessonCheck`: debounced re-check on `oristudioCpRevision`. Cheaper
      than planned — the store already holds the decoded snapshot, so the check
      is local and never touches the worker.
- [x] Feedback UI: progress line + per-kind notes + hint.
- [ ] Highlight missing creases *inside* the preview (plumbing exists via
      `TargetCpPreview.highlight`; not yet wired).
- [x] Content-integrity tests: unique ids, non-empty prose, every referenced
      target exists and parses as `.cp`.

### Phase 3 — Chapter 1: Basics ✅

- [x] The paper and the canvas (prose + explore).
- [x] Your first crease (segment tool, 1-crease target).
- [x] Mountain, valley, auxiliary.
- [x] Select, undo, delete (starts from a populated CP; deletes down to a subset).
- [x] Snapping and the grid (inscribed square on grid midpoints).
- [x] `lessonChecks.test.ts`: every draw step's target satisfies its own check,
      and a lesson's starting pattern never already satisfies it (which would
      make the step a no-op). Verified to fail when a target is mis-pointed.
- [ ] Images for the prose steps (none authored yet — the prose stands alone,
      but diagrams would help the mountain/valley explanation).

### Phase 4 — Chapter 2: Constructing creases ✅

Retitled from "Drawing tools": the useful split is not *which* draw tool but
hand-drawn vs. constructed-from-geometry, which is the distinction that matters
for whether a pattern folds.

- [x] Perpendiculars, angle bisectors, dividing a length, mirroring — four
      lessons, each with a start and target `.cp`.
- [x] Guard: every `teaches` id resolves to a real action.
      `OristudioCpActionId` is `cp.action.${string}`, so any string typechecks —
      all four ids in the first draft were wrong and compiled fine.
- [ ] Auxiliary-line lesson exercising the aux-inclusive check path (the
      `diagonal-with-guide` target exists but no lesson uses it yet).

### Phase 5 — Chapter 3: Foldability ✅

- [x] `action` step support: `useLessonAction` + a pure `evaluateLessonPredicate`
      with unit tests. (`viewport-moved` was dropped from the predicate union —
      nothing used it and it could not be observed honestly.)
- [x] `loadPracticeCreasePattern` seeds the CAMV diagnostics, without which the
      `camv-clean` step could never be satisfied.
- [x] Diagnostics lesson: broken pattern → clear the violations → clean.
      **Verified reachable in the browser** (4 issues → 0).
- [x] Fold lesson: `action` step satisfied when a folded figure exists.
      **Verified end to end** — select, fold, dismiss the foldability warning,
      figure appears, step reports satisfied.
- [ ] Send-to-Simulate lesson (deferred: Simulate keeps the learn slot, so the
      plumbing is in place, but the lesson is not written).

**Content note.** The chapter was rewritten after checking what the editor's
CAMV pass actually reports. The first draft asserted Maekawa violations at a
vertex where four mountain creases cross — but the checker evaluates vertices in
the document's *topology*, and two creases that merely cross without being
divided there do not form one. What it does flag in these patterns is creases
meeting the paper's edge partway along. The lesson now teaches that, and the
module carries a note telling the next author to verify against the running app
rather than reason from the theory.

### Phase 6 — Discovery, i18n, and validation

- [x] Help › Tutorial menu item. **No Rust change needed** — the native macOS
      menu is generated from the same `getMenuBarDef`, so it inherits the item.
      (An older note about a hand-maintained Rust menu is stale.)
- [x] Start-screen tutorial card; lesson index with completion state and Resume.
- [x] **UI chrome localized into all 8 locales** — 34 keys per locale, 222 in
      total, `i18n:stamp` applied, `i18n:check` green. Verified in the browser
      (Japanese chrome renders; `ステップ 1 / 3`).
- [x] `npx tsc --noEmit`, `eslint`, 895 web tests, `check:desktop`,
      `cargo fmt`/`clippy` on the touched crate — all green.
- [ ] **Lesson prose localization — the one substantial piece left.** 135 English
      strings / 2,858 words across 11 lessons, so 1,080 translations and roughly
      23,000 words across the 8 locales. Needs a generated `tutorial` namespace
      mirroring `cpVocab` (data module → catalog, kept in sync by a `.gen.test`),
      then the translation pass itself. Currently the prose lives as plain
      strings in the lesson data modules: it never reaches the extractor, so
      `i18n:check` stays green and the tutorial ships English-only.
- [ ] Manual run through one lesson in the Tauri dev app.

### Phase 7 — Polish (optional, evaluate after Phase 6)

- [ ] Ghost overlay of the target on the practice canvas (renderer program).
- [ ] Keyboard navigation and screen-reader pass over the lesson panel.
- [ ] Chapter 3 (Construct) and Chapter 4 (Transform) content.

### Deferred

- Chapter 7 (Design: tree → optimize → CP, and BP flap packing).
- Translated lesson prose beyond the English source.
- Any in-app lesson authoring UI.

## What driving every lesson found

The lessons were walked end to end in a browser after merging main — every draw
step reproduced with the real tool, every action step taken, every navigation
path exercised. Seven things only that could have found:

1. **The `camv-clean` predicate could never be satisfied.** A clean pattern still
   reports `diagnostics: ["Check CAMV found 0 issue(s)"]` — a summary line, not a
   violation — and the predicate required that array to be empty. The unit test
   missed it by inventing a clean result with no summary at all. Violations come
   from `diagnostic_entries`; the test now uses the strings the engine really
   returns.
2. **"Dividing a length" taught a tool that cannot produce its target.**
   `LineSegmentDivision` is "divide line by count": it splits *one* line into N
   pieces, where the lesson asked for N parallel creases. Worse, its whole output
   is vertices, which canonicalization deliberately erases — so the check could
   never see the work. Replaced with **Parallel creases** (`ParallelDraw`), whose
   target was derived by running the tool and recording what it produced.
3. **The learn layout hid the View panel**, which is where tool options *and* each
   tool's own step-by-step instructions live. A tutorial about tools that hides
   their instructions teaches half a tool, and three lessons pointed at a panel
   the user could not see. The learn workspace now mounts the same View pane as
   Edit.
4. **The perpendicular lesson had the click order backwards** and sent the crease
   the wrong way. The tool works *from a point towards a line*, and `+y` is down,
   so the crease runs to the bottom edge, not the top.
5. **Main moved the line-type buttons** from the bottom toolbar to the top of the
   tool rail, and replaced the "No fold" button with a Fold icon plus a `G`
   shortcut. Chapter 1 and the folding lesson both pointed at the old places.
6. **Two targets had become orphans** when lessons were rewritten. A test now
   fails on any target no lesson reaches.
7. Confirmed working under a real user's sloppiness: box-selecting "the two
   creases" also catches the paper edge, and the reflection still passes, because
   boundary edges are filtered before comparison.

`lessonFlow.test.ts` locks in what the walk verified: every step reachable, every
self-advancing step gated, skip always a way forward, last step completes.

## Shortcuts, and the foldability moment in chapter 1

Two later additions, both verified by driving them with the real keys.

**Shortcuts are quoted in the prose.** Telling someone the key is most of what
makes a tool stick, so the lessons name them: `A`/`S`/`D`/`F` for the four line
types, `Z` segment, `Q` box select, `C` flip mountain/valley, `Y` perpendicular,
`B` bisector, `G` fold, `Cmd+A` select all, `Cmd+Z` undo, and the viewport chords.
They are quoted rather than generated because the keys are woven into sentences —
so `lessonShortcuts.test.ts` asserts the other direction instead: every shortcut
the tutorial claims is still the registry's default, and any single-letter
"press X" in lesson prose must appear in its claims table. Rebinding a default
now fails the build naming the lesson to update.

**The line-types lesson now ends in a foldability arc.** Drawing the two
diagonals produces a real Maekawa violation, and this is by far the best moment
to explain the checker — the user made the error themselves, thirty seconds ago,
and can see the marker sitting on it.

Worth recording *why* it appears, because it is not obvious: the crossing splits
each diagonal into two creases, so the centre is four creases (two mountains, two
valleys) and the difference is zero. Loading the same pattern from a `.cp` does
**not** flag it, because nothing is split and no vertex exists — which is why an
earlier probe of this exact geometry came back clean and the opportunity was
missed the first time round.

The fix is one flip (`C`, click one half): three mountains and one valley, a
difference of two, clean. Then it folds — with no warning dialog, unlike the
chapter 3 fold — into a single triangle, the four quarters stacked. An earlier
draft of this step claimed the result was a cone; it is not, and 3M+1V satisfies
both theorems. Checked against the running app.

Chapter 3 now opens by referring back to this rather than re-teaching it, and
makes its own point sharper: the flags there are *not* at a crossing, they are
where creases meet the paper's edge.

## Browser verification checklist (author)

1. **Slot isolation.** Open a real document in `/edit`, make edits, leave it
   dirty. Go to `/learn`, take a lesson, draw. Return to `/edit`: same document,
   same history (undo still walks *your* edits, not the lesson's), same
   selection, same pan/zoom, still dirty. Save and export target your file.
2. Draw the target the "wrong" way — two collinear halves, reversed direction,
   slightly off-grid — and confirm the check still passes.
3. Draw the right line as a valley when the target is a mountain; confirm the
   "right line, wrong fold type" feedback.
4. Undo past the check-passing state; confirm the step un-completes.
5. Reload mid-lesson; confirm progress and the resumed step.
6. Same five, in the Tauri desktop app.
