# Design pane tabs (N designs, any kind, one `.osf`)

Scoping document. No code written yet.

## Goal

The Design workspace holds N design documents at once, each with its own tab,
undo stack, and engine handle. Adding a **third** design kind later must be a
matter of registering a descriptor — not editing the store, the menus, the
layout, or the file format.

### Decided constraints

| Question | Decision |
|---|---|
| File model | N designs in **one** `.osf` |
| Edit workspace | **One** crease pattern; every design appends into it via Import(Add) |
| Mixed kinds | **Yes** — a TreeMaker tab beside a Box-Pleat tab |
| Extensibility | A third kind must be trivial to add |
| Routing | Collapse to `/design`; delete `/design/treemaker` and `/design/bp` |
| Startup | One tab, in the NUX chooser state; every new tab opens the same way |
| Tab names | User-editable; names **and order** persist in the `.osf` |
| Engine handles | Lazy hydrate on activation, LRU evict; **3 hot** to start |
| Back-compat | `minimumReaderSchemaVersion: 8` — older builds refuse v8 files outright |
| CP provenance | Drop `OristudioCpLineage` entirely |
| Closing the last tab | Allowed; re-provisions a fresh NUX tab — so **there is always ≥ 1 tab** |
| Close confirmation | Only when the design has been touched. One-way, no undo |
| Default tab name | `Untitled Design` |
| Duplicate a design | Yes — tab context menu |
| File ▸ New | Replaces **all** tabs — tabs belong to one project. Renamed "New Project" to say so. One workspace-level `dirty`, one prompt covering every tab |

## Two findings that de-risk the hard parts

### 1. Lazy hydrate + LRU evict is an operation the app already performs

Both engines already round-trip a design through its text format on **every
undo**:

- TreeMaker — `undoTree()` calls `api.saveTmd5(treeHandle)` then
  `loadTreeFromText(engine, previous.text)`
  ([historySlice.ts:369–380](../apps/web/src/store/workspaceStore/slices/historySlice.ts))
- Box-Pleat — the store's undo path is `navigateBpHistory` → JS snapshot →
  `restoreOristudioBpProjectSnapshot(bps)`
  ([historySlice.ts:403](../apps/web/src/store/workspaceStore/slices/historySlice.ts),
  [oristudioBpRuntime.ts:260](../apps/web/src/store/workspaceStore/oristudioBpRuntime.ts)),
  which loads a **fresh handle** from `.bps` text

So "serialize to text, free the handle, reload later" is not new machinery and
not an unproven risk — it is the code path every undo already takes, in both
engines, in production. Eviction reuses it verbatim.

It also means the **persistence codec and the eviction codec are the same
thing**, which collapses two descriptor fields into one.

### 2. Resizable panes inside a tab need no new dependency

`dockview` re-exports `GridviewReact` and `GridviewApi`
(`node_modules/dockview/dist/cjs/gridview/gridview.d.ts`; `index.d.ts` re-exports
`./gridview/gridview`). `GridviewApi` serializes with `toJSON`/`fromJSON`, so a
design tab can host a resizable, persistable grid of its kind's panes using the
layout library and theme already in the app.

This means the "adjust the width of the panels inside a tab" ask is **not a
descope candidate** — it is roughly the same cost as a hand-rolled splitter and
gives serialization for free.

## Target architecture

```
Dockview (workspace shell — unchanged, 3 workspaces)
└── panel 'design'                      ← single, headerless, fixed id
    └── DesignWorkspace
        ├── DesignTabStrip              ← custom; order + names are document state
        └── GridviewReact               ← one per active tab
            └── panes declared by the active tab's kind descriptor
                  treemaker : tree | inspector | diagnostics | conditions
                  box-pleat : tree | packing
                  <third>   : whatever it declares
```

`inspector`, `diagnostics`, `conditions`, and `bp-editor` **move out** of the
workspace Dockview and **into** the design tab's Gridview. That single move is
what kills the current layout machinery:

- `mountedDesignVariant()` ([layoutStore.ts:222](../apps/web/src/store/layoutStore.ts)) — deleted; it infers the kind from panel presence and answers wrong the moment two kinds are open
- `layoutScope()` variants `design:box-pleat` / `design:nux` ([:46](../apps/web/src/store/layoutStore.ts)) — deleted; the workspace layout no longer varies by kind
- `ensureDesignLayout()`'s `dockviewApi.clear()` + rebuild ([:277](../apps/web/src/store/layoutStore.ts)) — deleted; nothing at the workspace level changes on a tab switch
- `DesignLayoutVariant`, `designLayoutVariant()`, `designVariantPath()`, `registerDesignVariantSource()` — all deleted

### The extensibility seam

```ts
interface DesignKindDescriptor {
  id: DesignKindId;                       // 'treemaker' | 'box-pleat' | …
  osfKind: NativeProjectDocumentKind;     // discriminator in the .osf document

  chooser: { title; description; icon; available(state): boolean };

  panes: DesignPaneSpec[];                // id, component, default grid position/size
  defaultPaneId: string;                  // the pane that owns the editing context
  editingContextFor(paneId): EditingContext;

  capabilities: { hideIds: Set<CapabilityId>; hidePrefixes: string[] };

  // One codec, three jobs: save, LRU eviction, and undo snapshots.
  codec: {
    create(): Promise<number>;            // fresh handle
    hydrate(text: string): Promise<number>;
    serialize(handle: number): Promise<string>;
    free(handle: number): Promise<void>;
  };

  sendToEdit(handle: number): Promise<string>;  // FOLD text for Import(Add)
  analyticsId: string;                    // enum value; never a user string
}
```

Note there is no `defaultTitle` — every tab starts as `Untitled Design`
regardless of kind, disambiguated by a numeric suffix (`Untitled Design 2`) only
when the name is already taken, so a lone tab never carries a pointless `1`.
Titles are pure document state and never derive from the kind.

Acceptance criterion for "trivial third kind": an integration test registers a
**stub** kind and asserts the chooser card, panes, menu masking, save, load,
evict, and rehydrate all work with **zero changes outside the descriptor**. If
that test needs an edit anywhere else, the seam is in the wrong place.

### Store shape

**Documents map as truth; the active design derived at the selector layer.**

```ts
designs: Record<string, DesignEntry>;   // truth for every open design
designOrder: string[];                  // non-empty; array order IS tab order
activeDesignId: string;                 // never null — see the ≥1 tab invariant

/** Metadata is always resident; engine-backed state is not. */
interface DesignEntry {
  id: string;                           // stable; also the .osf document id
  kind: DesignKindId | null;            // null = NUX, kind not yet chosen
  title: string;                        // user-editable tab name
  editCount: number;                    // 0 ⇒ close without confirming
  state: ParkedState | LiveState;       // discriminated — this is what LRU moves
}

interface ParkedState {
  status: 'parked';
  text: string;                         // serialized payload; no handle, no snapshot
}

interface LiveState {
  status: 'live';
  handle: number;
  project: TreeProject;                 // …whatever the kind materializes
  history: { past: HistoryEntry[]; future: HistoryEntry[] };
  selection: Selection;
  paneLayout: SerializedGridview | null;
}
```

Reads go through one helper — `activeDesign(state)` — so a component selector
becomes `useWorkspaceStore((s) => activeDesign(s).project)`. It is a plain object
lookup returning a stored reference, so referential identity is stable and
zustand's `Object.is` comparison behaves exactly as it does today.

The `ParkedState | LiveState` union is what makes this compatible with lazy
hydrate + LRU: eviction is a transition from `live` to `parked` (serialize, free
the handle, drop the materialized snapshot), and activation is the reverse. At
most three entries are `live`; the active one always is.

### Why not a getter on the store

The instinct — "make `state.project` a computed getter over the map" — is the
right one, but it cannot be implemented as a getter. Zustand's `setState` is:

```js
state = Object.assign({}, state, nextState)   // node_modules/zustand/esm/vanilla.mjs:8
```

`Object.assign` **invokes** getters on its sources and writes plain data
properties to the target. A getter defined on the initial state object therefore
survives exactly until the first `set()`, after which it is a frozen value that
no longer tracks anything. The store calls `set({ project: … })` in dozens of
places, so the getter would die during app startup and fail silently — the worst
possible failure mode.

Derivation has to happen at the **selector** layer, above `setState`, which is
what `activeDesign(state)` does.

### Why not check-out / check-in

A considered alternative: keep the flat fields as "the design you are looking at"
and, on tab switch, serialize the outgoing design into a parked record and
hydrate the incoming one into the flat fields — *move* semantics, so no field is
ever duplicated. It touches zero read sites.

It was rejected on R15. Under move semantics an `await` that outlives a tab
switch has no document to address — the write is ambient, so the only remedy is a
guard that *drops* it, across ~101 async actions. Under the documents map a write
is addressed (`designs[capturedId]`), so the same race routes the result to the
design it belongs to and nothing is lost.

The trade is a large **mechanical, compiler-enumerated** diff (≈291 reference
sites across src and tests: 133 `project`, 78 `oristudioBpDocument`,
80 `designMethod`) against a small **race-prone** one. Deleting the flat fields
makes `tsc` list every site that must change; no compiler finds a missing
staleness guard.

History is already JS-side text snapshots in both kinds, so it lives in
`LiveState` and serializes into the parked text with everything else.

### The ≥ 1 tab invariant

Closing the last tab re-provisions a fresh NUX tab, so `designDocuments` is
never empty and `activeDesignId` is never null. That removes an entire class of
"no design open" states from the store, the tab strip, the Gridview, and every
capability selector — worth stating as an invariant and asserting in a test,
because it is load-bearing well beyond the close button.

### "Touched", not "has content"

Close confirms only for a design the user has actually worked on. The obvious
predicate — *does this design have content* — is **wrong for Box-Pleat**:
`chooseDesignMethod('box-pleat')` → `createOristudioBpProject` →
`createSampleOristudioBpProject`, which calls `api.newSampleProject()`
([oristudioBpRuntime.ts:199](../apps/web/src/store/workspaceStore/oristudioBpRuntime.ts))
and sets `dirty: true`. A brand-new, untouched BP tab therefore has a full sample
tree in it and is already dirty, so a content test would prompt on every close.

Use `editCount > 0` instead — incremented by the document's own mutations, not by
provisioning. Kind-agnostic, so a third kind inherits the right behavior with no
descriptor field at all.

### Duplicate

`serialize(source.handle)` → `hydrate(text)` → new id, title `"<name> copy"`,
inserted immediately after the source tab. History is **not** copied and
`editCount` starts at 0 — the copy is a new document, and carrying the original's
undo stack would let the user undo the duplicate into states it never had.

## Phases

| # | Phase | Work | Size |
|---|---|---|---|
| 0 | **Design-kind registry** — the descriptor above, plus `treemaker` and `box-pleat` implementations built from existing code. No behavior change. | S–M | 3–4 d |
| 1 | **Document registry** — one owner of handle lifecycle across `engineRuntime` / `oristudioBpRuntime`; `create`/`hydrate`/`serialize`/`free` per document; hot-set cap + LRU eviction. Replaces `let handle` singletons ([engineRuntime.ts:16](../apps/web/src/store/workspaceStore/engineRuntime.ts), [oristudioBpRuntime.ts:38](../apps/web/src/store/workspaceStore/oristudioBpRuntime.ts)). | M | 4–5 d |
| 2a | **Design tabs container** — `designTabs[]` + `activeDesignId` replace the `designMethod` scalar; the authoring method moves onto the design. ≥1-tab invariant. No editing state moves. | M | 1–2 d |
| 2b | **TreeMaker state into the tab** — `project`, tree history, `selection`, `toolMode`, `symmetryAuthoringPairs`, `lastOptimization`, `designViewportFitRequestId`, as the `kind: 'treemaker'` arm of a discriminated union (see "Why `kind` is stored"). ~80 sites. | L | 3–4 d |
| 2c | **Box-Pleat state into the tab** — the nine `oristudioBp*` fields, as the `kind: 'box-pleat'` arm. ~41 sites. | M | 2–3 d |
| 2d | **Addressed writes** — every async design action captures its document id and writes that design, never "the active one". Removes R15 structurally. Registry starts driving handles. | M | 2–3 d |
| 3 | **Tab strip** — Radix `Tabs` for roving focus and ARIA; add (opens in NUX), close, inline rename, duplicate, reorder. Order and names write to the document. | M | 3–4 d |
| 4 | **Intra-tab Gridview** — move `inspector`/`diagnostics`/`conditions`/`bp-editor` into the tab; per-tab pane sizes; active-pane tracking replaces Dockview's `onDidActivePanelChange`. | M | 4–5 d |
| 5 | **Route collapse** — `/design` only; `/design/treemaker` and `/design/bp` become `redirect()`s; delete `designVariantPath`, `parseWorkspacePath`'s design branches, `pathForWorkspace`'s design special-case ([landing.ts:22](../apps/web/src/routing/landing.ts)). | S | 1–2 d |
| 6 | **`.osf` v8** — unique per-document ids replacing `TREE_DOCUMENT_ID`/`BOX_PLEAT_DOCUMENT_ID` ([nativeProjectFile.ts:274](../apps/web/src/lib/nativeProjectFile.ts)); N-document load loop replacing `activeNativeDocument()` + kind-branch ([projectSlice.ts:1203](../apps/web/src/store/workspaceStore/slices/projectSlice.ts)); tab order/titles/pane layouts; `minimumReaderSchemaVersion: 8`; drop `oristudioCpLineage`; v1–v7 migration. | M | 3–4 d |
| 7 | **Contexts** — `resolveEditingContext` from (active tab kind, active pane) instead of the `activePanelId` string switch ([editingContext.ts:38](../apps/web/src/workspaces/editingContext.ts)); capability masking from the descriptor instead of the hardcoded `bp-tree`/`bp-packing` branch ([workspaceCapabilities.ts:925](../apps/web/src/lib/workspaceCapabilities.ts)); shortcut executors keyed per pane instance ([shortcutRuntime.ts:31](../apps/web/src/keyboard/shortcutRuntime.ts)); undo/redo resolve the active tab first. | M | 4–5 d |
| 8 | **Analytics + i18n** — `design tab opened/closed/renamed/switched` with `design_kind` enum and **bucketed** tab counts; new strings; `i18n:check` hash. | S | 1–2 d |
| 9 | **Tests + browser verification** — stub-kind extensibility test, evict/rehydrate equivalence, cross-tab undo isolation, `.osf` round-trip. | M–L | 4–5 d |

**Estimate: ~6–8 weeks** solo. Phase 2 is the critical path and everything
after it is parallelizable.

**Shippable midpoint:** Phases 0–2 land as a pure refactor with N=1 and no
visible change — reviewable, revertable, and green against today's tests.

## Risks and mitigations

### R1 — Phase 2 touches ≈291 reference sites
133 for `project`, 78 for `oristudioBpDocument`, 80 for `designMethod`, across
src and tests.

**Mitigation:** make it a diff the compiler enumerates. Deleting the flat fields
outright means `tsc` lists every site that must change — there is no "I think I
got them all". Land at N=1 with no UI change, so `store.test.ts` (6,290 lines)
stays green as the correctness check; at N=1 the map is unobservable from
outside. `store.test.ts` reads via `getState().project` 88 times but *sets* those
fields only once, so nearly all of the test churn is compiler-found reads.

Breadth is the cost being paid deliberately here, to avoid R15 — see "Why not
check-out / check-in" above.

### R2 — Unbounded wasm memory / handle leaks
Today `replaceHandle()` frees the previous tree on every load, so leaks are
structurally impossible. With N documents that guarantee disappears, in a runtime
that already OOMs on a single large `.osf` on desktop.

**Mitigation:** one `DocumentRegistry` owns every create/free with `finally`-based
release; a hard cap on hot documents; a dev-only assertion that live handles
equal hot documents. Never call `freeProject`/`freeTree` outside the registry.

**R2b — the BP optimizer is a module singleton with global cancel state.**
`optimizerWorker`, `optimizerClient`, and `optimizerCancelRequested`
([oristudioBpRuntime.ts:35–37](../apps/web/src/store/workspaceStore/oristudioBpRuntime.ts))
are all module-level, and `cancelActiveOristudioBpOptimizer()`
([:178](../apps/web/src/store/workspaceStore/oristudioBpRuntime.ts)) terminates
*the* worker and sets the flag. `optimizerCancelRequested` is reset at :126 and
:157 — safe with one design, a race with several. With N box-pleat tabs:

- only one optimize can run at a time across all of them;
- a cancel issued from tab B terminates tab A's run;
- a run started on B can observe a stale cancel flag left by A.

**Recommendation: keep it single.** The exposure is narrower than the globals
suggest, because the optimizer is already single-run *by UI construction*:

- one global `BpOptimizerUiState` — `isOpen`, `running`, `progress`, `error`
  ([bpOptimizerUiStore.ts](../apps/web/src/store/bpOptimizerUiStore.ts));
- the run button is `disabled={running}` and close is blocked while running
  ([BpOptimizerModal.tsx:170, :186](../apps/web/src/components/BpOptimizerModal.tsx));
- the dialog is `role="dialog" aria-modal="true"` over a full-cover `.simple-modal`
  whose backdrop `onMouseDown` is swallowed while running
  ([:163–172](../apps/web/src/components/BpOptimizerModal.tsx)).

So a second run cannot be started, and the tab strip cannot be clicked, while one
is in flight. Keying the worker per document would buy concurrency nobody asked
for, at the cost of N heavy workers competing for CPU behind a single progress UI.

Make the invariant explicit rather than incidental — three small pieces:

1. Record the owning document id on the in-flight run; ignore a result or a
   cancel whose id does not match. This converts "safe because the dialog happens
   to prevent it" into "safe by construction", in a few lines.
2. Pin that document against LRU eviction while the run is live (R14).
3. Make sure a new tab-switch shortcut cannot fire while a modal is up — the
   shortcut scope machinery should already cover this, but it needs checking
   rather than assuming.

**A payoff worth recording.** `bpOptimizerUiStore.ts` says the dialog deliberately
omits upstream's `openNew` option because *"we have no BP project tabs, so the
optimizer always replaces in place"*. Design tabs remove that blocker: `openNew`
becomes implementable as "run the optimizer, put the result in a **new tab**,
leave the original untouched" — an upstream Box Pleating Studio parity feature
currently held back only by the absence of tabs. Out of scope here, worth a
follow-up. It also argues for the single-worker shape: `openNew` is one run
producing one new tab, not N concurrent runs.

### R3 — Eviction silently loses in-memory state
Anything held in the wasm session but absent from the text format is destroyed
on evict.

**Mitigation:** this is already exercised — both engines round-trip through text
on every undo (see the finding above), and history is JS-side text snapshots that
live in `LiveState`. Add an explicit equivalence test:
`hydrate → edit → evict → rehydrate` must equal the never-evicted result, for
every registered kind.

Two specific worries were checked and are **not** problems:

- **BP wasm-side history.** `BpProjectSession { project, history: HistoryManager }`
  ([project_session.rs:23](../crates/oristudio-bp/src/engine/project_session.rs))
  does hold an undo stack that `.bps` text does not carry, so eviction destroys
  it. But nothing consumes it: `undoOristudioBpTree`/`redoOristudioBpTree` have
  zero callers in `apps/web`, nothing reads `OristudioBpDocumentState.history`,
  and the capability layer counts JS snapshots
  ([capabilities.ts:35](../apps/web/src/store/workspaceStore/capabilities.ts)).
- **TreeMaker conditions.** They are applied to the tree handle
  (`applyEdit(treeHandle, { type: 'delete_condition' })`,
  [conditionSlice.ts:88](../apps/web/src/store/workspaceStore/slices/conditionSlice.ts))
  and `to_tmd5_string` serializes them (`out.u(self.conditions.len())`,
  [treemaker-core/src/lib.rs](../crates/treemaker-core/src/lib.rs)), so they
  survive the round trip.

The equivalence test still earns its place — it is what keeps this true as the
formats change.

### R4 — Replacing Dockview's active-panel tracking
Moving panes into a Gridview means the app owns "which pane is active", and that
value drives menus, capabilities, and shortcut routing. Getting it wrong
misroutes commands silently.

**Mitigation:** a single writer, set from a `pointerdown` capture handler on each
pane root — **not** from focus (AGENTS.md: no panel behavior may depend on where
DOM focus is). `isShortcutEditingTarget` stays the one editing-target predicate.
Table-driven test: every (kind, pane) pair resolves to the expected
`EditingContext`.

**Scope is larger than "one mechanism".** Eleven call sites address panels by
string literal through `useLayoutStore.activatePanel`, and three name panes that
move into the Gridview — `'design'` and `'conditions'`
([menuActions.ts:621, :632](../apps/web/src/commands/menuActions.ts)) and
`'inspector'` ([useBpLongPressInspector.ts:67](../apps/web/src/hooks/useBpLongPressInspector.ts)).
One needs real care:

`setOristudioBpActiveSurface`
([oristudioBpSlice.ts:530–543](../apps/web/src/store/workspaceStore/slices/oristudioBpSlice.ts))
maps a BP surface to `'bp-editor'` / `'design'` and activates it, but defers the
activation to `runAfterPointerGesture` — because activating mid-gesture reflows
the pane and the browser then never fires the click. That deferral must survive
the move to intra-tab pane activation, or the first click on an unfocused BP pane
starts getting dropped again.

**Pre-existing bug found while auditing this, tracked separately:**
`useBpLongPressInspector` is used only from `BpPackingPanel` and `BpTreePanel`,
and calls `activatePanel('inspector')` — but `applyDesignLayout`'s box-pleat
branch returns before `addDesignSidePanes`, so no `inspector` panel exists, and
`InspectorPanel.tsx` has no BP support anyway. The gesture is a silent no-op
today. Not caused by this project; don't deepen the dependency while migrating.

### R5 — Layout persistence fights document persistence
Dockview's localStorage layout and the `.osf` would both claim to own pane
arrangement.

**Mitigation:** clean split — the workspace Dockview persists only the 3-workspace
shell; intra-tab pane sizes go in the `.osf` per tab; tab order and names are
document state. Bump `LAYOUT_VERSION` (17 → 18). `STORAGE_KEYS`
([storage.ts:20](../apps/web/src/lib/storage.ts)) has exactly two layout keys and
nothing else is scoped by design variant, so the blast radius is `layoutScope()`
alone.

One detail worth not missing: **keep `design:box-pleat` and `design:nux` in
`ALL_LAYOUT_SCOPES`** ([layoutStore.ts:85](../apps/web/src/store/layoutStore.ts))
even after nothing writes them. That list is what `clearAllPersistedLayouts()`
iterates in the app-level error-recovery path; removing the dead scopes would
leave those keys in every existing user's `localStorage` permanently, with no
code path able to clear them.

### R6 — `minimumReaderSchemaVersion: 8` strands users mid-update
Every save from the new build becomes unopenable in any older build, including
single-design files. `NativeProjectFileV1.minimumReaderSchemaVersion` is currently
the literal type `1` ([nativeProjectFile.ts:159](../apps/web/src/lib/nativeProjectFile.ts)),
so this is a type change as well as a policy change.

**Mitigation:** ship **reader-first**. One release understands schema 8 but still
writes 7; the next starts writing 8. Users who update lazily are never handed a
file their build refuses. `migrateNativeProjectFile` already produces a clear
`project_file_too_new` error ([:330–360](../apps/web/src/lib/nativeProjectFile.ts)),
so the failure mode is legible — and `minimumReaderSchemaVersion` is already
precisely the refuse-to-open mechanism, no new machinery needed.

**The migration itself is smaller than it sounds.** There is no per-version
migration chain: `migrateNativeProjectFile` routes schema versions 1 through 7
all to the same `validateV1(value)`
([:339–350](../apps/web/src/lib/nativeProjectFile.ts)). So "v8 + migration" is
really "extend the validator to accept both document-id shapes" — the constant
per-kind ids of v1–v7, and unique per-tab ids in v8.

### R7 — Cross-tab undo — mostly dissolved by the Phase 2 shape
Undo is dispatched by `activeEditingContext` today, and with N tabs, undoing in
tab B must never touch tab A.

**Mitigation:** history lives in `LiveState`, so each design owns its own stack
and `undo()` reaches it only through `activeDesign(state)`. Tab A's stack is not
addressable while B is active. The existing `activeEditingContext` dispatch keeps
working unchanged — it decides *which kind* of history, and the map decides
*whose*.

What remains is a test, not a mechanism: edit in A, switch to B, undo, switch
back, assert A is untouched and its own redo stack survived the trip. Worth
having precisely because the guarantee is structural and could be quietly broken
later by someone hoisting history back up to the top level.

### R8 — Route collapse breaks live links
`/design/treemaker` and `/design/bp` are real URLs today and are produced by
`pathForWorkspace` ([landing.ts:22](../apps/web/src/routing/landing.ts)).

**Mitigation:** keep both as `redirect()` entries in `appRouter` for at least one
release rather than deleting the paths outright. Land Phase 5 of
[open-landing-and-design-state.md](open-landing-and-design-state.md) first
(`activateWorkspace` private to the route layer, delete `workspaceUrlSync`) —
collapsing to a single design route is much simpler once routing owns workspace
changes.

### R9 — Tab names are user content and must never reach PostHog
`docs/analytics.md:113` — never send raw user content.

**Mitigation:** tab events carry `design_kind` (enum) and a **bucketed** tab
count. No names, ever.

Note the type system cannot help globally here:
`AnalyticsPropertyValue = string | number | boolean | null | undefined | string[]`
([events.ts:12](../apps/web/src/analytics/events.ts)) permits arbitrary strings by
design, because existing events legitimately send enum strings (`method:
'treemaker'`). Narrowing it would break them. The realistic guard is a
**per-event** property type for the tab events — e.g.
`{ design_kind: DesignKindId; tab_count: TabCountBucket }` — so the tab call sites
specifically cannot pass a free string. Review has to carry the rest.

### R10 — Dropping lineage
`OristudioCpLineage` is persisted in the `.osf` and `markGeneratedCpLineageStale`
is called from `historySlice`.

**Mitigation:** nothing user-visible is lost — `cpLineageStatusLabel`
([oristudioCpLineage.ts:91](../apps/web/src/lib/oristudioCpLineage.ts)) has **zero
callers**, so the "Design changed" staleness label was never rendered. Remove the
field in the same v8 bump; the validator drops it.

Correction to the earlier sizing: this is **64 non-test reference sites**, not a
single field — the type threads through `nativeProjectFile.ts`, both CP runtimes,
`historySlice`, and `projectSlice`. Still mechanical and compiler-enumerated, but
budget it as a day, not an hour.

### R11 — Panes lose their error boundaries when they move
`withPanelErrorBoundary` wraps at Dockview registration
([PanelComponents.tsx:34](../apps/web/src/components/panels/PanelComponents.tsx)),
so panes moved into a Gridview would silently lose it and a crash in the
inspector would take the whole tab down.

**Mitigation:** wrap at intra-tab pane registration the same way — one place, so a
newly declared pane cannot forget it. The wrapper is typed
`(Panel: FC<IDockviewPanelProps>, panelId: string) => FC<IDockviewPanelProps>`
([withPanelErrorBoundary.tsx:34](../apps/web/src/components/errors/withPanelErrorBoundary.tsx)),
so it needs a Gridview-props variant — the body (an `ErrorBoundary` with
`surface: panel:<id>` and `useDocumentResetKeys()`) is prop-agnostic and carries
over unchanged.

## Audited and unchanged

Checked against the code during the risk review; no new hazard found:

- **R8 — route collapse.** Only two files outside `paths.ts` reference the design
  sub-paths: `DesignMethodChooser.tsx:25` and `WelcomeRoute.tsx:61` (which already
  navigates to bare `/design`, the correct destination under the new scheme).
- **R13 — close confirmation.** `requestChoice(options): Promise<string | null>`
  ([commandDialogStore.ts:198](../apps/web/src/store/commandDialogStore.ts)) is
  exactly the shape needed, already used by `fileDropController`.
- **Native menu.** `useTauriNativeMenu` rebuilds from `useWorkspaceCapabilities()`
  with an in-flight-drop guard, so it follows the active tab for free once
  capabilities resolve per design. No tab-specific work.
- **`projectEstablished`.** One writer (`chooseDesignMethod`) plus one
  document-presence subscription ([store.ts:58–64](../apps/web/src/store/workspaceStore/store.ts));
  the semantics ("a project exists this session") are unaffected by how many
  designs are open.

### R12 — "Trivial third kind" is unfalsifiable without a test
Every kind-specific `if` that survives is a future edit for the third kind.

**Mitigation:** the stub-kind integration test is the acceptance criterion, not a
nice-to-have. Plus a grep gate: no `'treemaker'` or `'box-pleat'` string literals
outside `designKinds/`. That gate currently has **50 non-test occurrences** to
clear — a useful progress metric for Phase 0, and a hard number to hold the
"trivial third kind" claim to.

### R13 — Closing a tab is destructive and one-way by decision
One `.osf`, one `dirty` bit, no undo path for a closed tab.

**Mitigation:** confirm on close when `editCount > 0`, reusing the existing
`requestChoice` dialog pattern from `fileDropController`. The predicate matters —
see "Touched, not has content" above; the naive version prompts on every
untouched Box-Pleat tab.

### R14 — LRU eviction can pull a handle out from under running work
The hot cap is 3, but background work outlives a tab switch: the BP optimizer
runs on its own worker with a cancel path
([oristudioBpRuntime.ts:178](../apps/web/src/store/workspaceStore/oristudioBpRuntime.ts)),
and TreeMaker's `optimize_scale`/`optimize_edges`/`optimize_strain` all mutate a
handle. Switching between three other tabs while an optimize runs would evict —
and `free` — the handle it is writing to.

**Mitigation:** the registry **pins** any document with in-flight engine work and
never evicts a pinned one. If every hot slot is pinned, exceed the cap rather
than evict; the cap is a target, not a hard limit. A pinned document is also
never serialized mid-run, so no torn snapshot can reach the `.osf`.

### R15 — An `await` that outlives the tab switch writes to the wrong design
Roughly 101 design-scoped store actions are `async` — projectSlice 37,
editingSlice 26, oristudioBpSlice 26, conditionSlice 9, historySlice 3 — and each
is shaped `await engine…; set({...})`. If a write means "the active design", then
switching tabs during that await lands the result on whichever design the user is
now looking at. Silent, data-corrupting, and timing-dependent, so it will not
show up reliably in tests written after the fact.

**Mitigation — structural, and the reason the documents map won over check-out /
check-in.** With `designs[id]` as truth, an action captures its document id
before the first `await` and writes to that id. A tab switch mid-flight is then
simply not a hazard: the result lands on the design it came from. Nothing to
guard, nothing to drop, no wrapper a future action can forget.

The residual is the narrower case where the target design was *closed* mid-flight
— the write finds no entry and must no-op. One `if`, in `applyDesignPatch`, not
101 call sites.

Prior art for the id-capture idiom: `documentLoadSerial`
([oristudioCpRuntime.ts:45](../apps/web/src/store/workspaceStore/oristudioCpRuntime.ts)),
bumped before each load and compared after.

Test with a deterministic hook: a resolvable promise in the engine mock, switch
tabs while it is pending, resolve, assert the result landed on the *originating*
tab and the new one is untouched.

## Tab strip: Radix + what it does not cover

Use `@radix-ui/react-tabs`. It is a new dependency but from a family the app
already relies on in four places (`react-dropdown-menu`, `react-select`,
`react-switch`, `react-tooltip`), and it carries the `tablist`/`tab`/`tabpanel`
roles, `aria-selected`, roving tabindex, and arrow-key navigation — the things
that are tedious and easy to get subtly wrong by hand.

What Radix does **not** give, and how each is covered:

| Need | Approach |
|---|---|
| Context menu (Duplicate / Rename / Close) | Reuse [`components/ui/ContextMenu.tsx`](../apps/web/src/components/ui/ContextMenu.tsx) — already Radix `DropdownMenu` behind a `ContextMenuItem` descriptor type |
| Close button inside a tab | **Do not nest it inside `Tabs.Trigger`** — an interactive control inside `role="tab"` is unreachable and invalid. Make the tab a flex container with the trigger as its label and the close button a sibling |
| Inline rename | Double-click swaps the label for an input. While editing, the input must own its keystrokes — `isShortcutEditingTarget` ([shortcutDispatcher.ts](../apps/web/src/keyboard/shortcutDispatcher.ts)) is the canonical predicate; do not write a second one |
| Reorder | No drag library in the repo. Hand-rolled pointer reorder — and it needs a keyboard equivalent (context-menu "Move left / Move right"), because drag alone is not accessible |

One structural note: Radix unmounts inactive `Tabs.Content` by default. Do **not**
fight that with `forceMount` — under lazy hydrate only the active design has a
live engine handle anyway, so render a single `GridviewReact` outside `Tabs.Content`
and key it by the active tab. Pane sizes survive because `paneLayout` is parked
per tab and restored on check-out.

## Resolved decisions

Recorded here so the reasoning survives:

| Question | Decision | Consequence |
|---|---|---|
| Closing the last tab | Allowed; re-provisions a fresh NUX tab | `designDocuments` is never empty; `activeDesignId` is never null |
| Confirm on close | Only when touched; one-way | Needs `editCount`, not a content test (R13) |
| Default tab name | `Untitled Design` | Kind-agnostic; numeric suffix only on collision |
| Hot-tab cap | 3 to start | Plus pinning for in-flight work (R14) |
| Duplicate a design | Yes, tab context menu | `serialize` → `hydrate`; fresh history, `editCount` 0 |

## Phase 0 notes

Four things the implementation settled that the scope had guessed at.

### `sendToEdit(handle)` was the wrong signature

The two paths are not the same shape. TreeMaker builds creases then exports FOLD;
box-pleat exports `.cp`, swaps the mountain/valley convention, **and needs the
Edit canvas's grid divisions** to compute its scale. So the descriptor method is
`sendToEdit(handle, request)` returning `{ text, format, label, filename }` — the
argument list to `importAddOristudioCpText`.

Box-pleat now reads its sheet from `api.snapshot(handle).design.layout.sheet`
rather than from `oristudioBpDocument.snapshot.packing.sheet` in the store. Same
value, but sourced from the handle — which is what will let a design that is *not*
on screen be sent to Edit once tabs exist.

### Localized copy has to be a function, not data

`i18n:extract` builds the English catalogs by scanning for literal
`t('ns:key', 'English')` calls. A descriptor holding `titleKey` + `defaultTitle`
as strings would make its copy invisible to the extractor and orphan the
translations. So `chooser.copy` and `pane.title` are `(t) => …` functions with the
literal calls **inside each kind's own module** — the extractor sees them, and a
third kind still needs no edit to a shared file. Six new `panels:design.paneTitle.*`
keys were added and translated for all eight locales.

### The equivalence oracle earned its keep immediately

Moving `BP_HIDDEN_CAPABILITIES` onto the descriptor exposed a rule that a
straight reading would have dropped: the shared "hide `cp.*` outside the CP
editor" rule deliberately exempts `cp.build`, but the old BP branch hid **all**
`cp.*` including `cp.build`. Modelled now as box-pleat listing `'cp.'` in its own
`hiddenPrefixes`. Caught by the mask-equivalence test, not by review.

### Two closed unions are the real cost of a third kind

`registry.test.ts` registers a stub kind and drives it through every
registry-backed consumer. Two casts were needed, and each stands for a genuine
one-line edit outside `designKinds/`:

- `DesignKindId` (aliased to `WorkflowTarget`) — a new member.
- `EditingContext` — a new member per pane context the kind introduces.

That is the honest shape of "trivial": one descriptor module, one registry entry,
and two union members. Everything else — chooser card, ordering, availability,
capability masking, pane layout, codec, send-to-edit — is data.

**R12 gate:** kind literals outside `designKinds/` went 50 → 48. Most of the
remainder is the store's `designMethod` handling, which Phase 2 owns.

**Gate caveat, found in Phase 1:** the raw grep cannot distinguish a design-kind
id from an engine id, and the treemaker engine is spelled `'treemaker'` too — so
`connectEngine('treemaker')` counts against the gate while meaning nothing about
extensibility. Renaming the engine would be worse (it matches `WorkerName` and the
crate). Track `'box-pleat'` alone as the clean signal instead: **37** outside
`designKinds/`, with no id collision.

## Phase 1 notes

### Client ownership: an engine host, not the document registry

Decided before implementing (see the discussion recorded in R2/R14). Ownership
inverted out of the descriptors, but into `engines/engineHost.ts` rather than the
document registry, because worker lifetime is not a per-design-kind concern:
there are six workers and only two back design kinds. The registry consumes the
host; the Edit canvas uses it directly.

The deciding evidence was that half of it already existed.
`lib/workerDiagnostics.ts` already enumerates all six workers, already reports
terminal failure ("a worker that dies … leaves every in-flight call pending
forever"), and its disposer already exists so *"a replacement worker's listeners
are the only live ones"* — the code anticipated respawn, but nothing implemented
it, because no module owned "the worker for engine X".

Scope: the three **persistent** engines. `oristudio-bp-optimizer` stays where it
is — spawned per run, terminated in a `finally`, so its lifetime is a call rather
than a session, and modelling it here would make `connect`/`reset` mean two
things. `simulator` and `cp-detect` are services, not document stores; each is one
table entry away if that changes.

`attachWorkerDiagnostics` gained an optional owner-observer, so the host can drop
a dead client *and* the app's existing error toast still fires. One set of
listeners, two consumers.

### Two bugs the tests found, both real

**`acquire()` consumed the parked text.** Hydrating deleted the serialized copy,
so a document that had been parked once became unrecoverable again simply by
being reopened — defeating the entire point of surviving a crash. The parked text
is now *kept* as the last-known-good snapshot; `park` overwrites it with something
fresher. Costs the text staying resident for at most `hotLimit` documents.

**`pinned()` pinned too late.** It hydrated first and pinned after, so anything
running while `acquire` was suspended could evict the very document the pin
existed to protect. Pins now live in their own map keyed by document id,
established *before* the hydrate. Pins also block an explicit `park`, not just
eviction — a tab switch mid-optimize must not serialize a torn state.

Neither would have been caught by review; both came from tests that assert
*when* the registry serializes and frees, not just that it can.

### `recoverable` is part of the contract

A document created and never parked has no captured text, so an engine crash
really does lose it. The `parked` event carries `recoverable: false` for that case
rather than fabricating an empty document to hydrate from. Phase 2 decides what
the tab does about it.

### Naming

`use()` had to become `acquire()` — `react-hooks/rules-of-hooks` treats any
function named `use*` as a hook. Better name regardless: it pairs with `park`.

### Not yet load-bearing

The host is wired into all three runtimes, so it is live. The **document registry
is not yet driving the store** — that is Phase 2's job, and wiring it early would
mean building the documents map twice. It is fully covered by tests in the
meantime.

## Phase 2a notes

### Phase 2 was one phase too big, and the measurement said so

The 291-site figure was a bad basis for planning. Measured properly, non-test
references are **concentrated in `store/`** — 69 of the `project` reads, 31 of
`oristudioBpDocument`, 15 of `designMethod` — against ~26 in `components/` and a
handful elsewhere. Nothing in `cp-workspace/`, `hooks/`, or `lib/` at all.

That makes a field-group-at-a-time migration natural, and each one lands green:
2a the container, 2b TreeMaker state, 2c Box-Pleat state, 2d addressed writes.
2a is the piece Phase 3 actually needs — the tab strip wants id, kind, title,
and order, none of which require the editing state to have moved yet.

### An array, not a map plus an order list

The scope said `designs: Record<id, …>` + `designOrder: string[]`. Implemented as
a single `designTabs: DesignTab[]` instead: the array order *is* the tab order,
and maintaining a map and a parallel order list would be a duplicated fact of
exactly the kind this project keeps removing. Tab counts are small enough that
linear lookup is irrelevant.

### `editCount` deferred, and probably unnecessary

The plan gave each tab an `editCount` for the close-confirmation predicate.
Deferred, because TreeMaker edits have no chokepoint to increment it at —
`api.applyEdit` is called from ~20 places in `editingSlice` directly (BP does
have one, `runBpTreeMutation`). Adding 20 increment sites for state nothing reads
yet is the "dead code drifts" trap from Phase 0.

It may not be needed at all: **`historyPast.length > 0` already means "edited
since load"**, and history becomes per-design in 2b. Phase 3 should try that
before adding a counter.

### Tab identity survives a method change

Picking a method patches the existing tab's `kind` rather than replacing the tab.
Asserted directly, because Phase 3 hangs a tab strip off these ids — a swapped
tab would lose selection, title, and position on every choice.

### Why `kind` is stored rather than derived — and the constraint it puts on 2b

Reasonable question raised in review: if a tab holds a box-pleat document, why
record `kind: 'box-pleat'` as well? Could the kind not be read off the content?

For a **saved file** it effectively is: `.osf` records `kind` explicitly per
document ([nativeProjectFile.ts:73](../apps/web/src/lib/nativeProjectFile.ts)),
so loading reads it rather than guessing. The problem is in-memory state, and it
is one case:

**A fresh Circle-packed design has no content.** `createBlankTree` is
`newDesign()` with zero nodes and zero edges
([engineRuntime.ts:87](../apps/web/src/store/workspaceStore/engineRuntime.ts)),
which is why the presence subscription tests `project.edges.length > 0` and its
comment already says *"a blank TreeMaker design picked from the chooser has no
document content"*. Derive the kind from content and picking Circle-packed
bounces straight back to the chooser — the contradiction
[open-landing-and-design-state.md](open-landing-and-design-state.md) exists to
prevent.

Two smaller ones: box-pleat creation is async, and the "Preparing the box-pleat
editor…" state is only expressible because the kind is known before the document
exists; and the two kinds are asymmetric (box-pleat's create seeds a sample
project *with* content, TreeMaker's does not), so a derivation rule would need
per-kind special-casing — the thing the descriptor registry exists to remove.

The kind is a **decision the user made**, and it has to survive the window before
that decision has produced anything. Derive facts about content; store decisions.

**Constraint this places on 2b/2c.** Storing it does make a contradictory tab
representable — `kind: 'treemaker'` beside a box-pleat document. Rather than
guard that with an invariant test, the per-design state moving onto the tab in
2b/2c must be a **discriminated union keyed on `kind`**:

```ts
type DesignTabContent =
  | { kind: null }                                    // chooser
  | { kind: 'treemaker'; project: TreeProject; … }
  | { kind: 'box-pleat'; document: OristudioBpDocumentState; … }
```

Then the contradiction does not compile, and there is nothing to keep in step.
The read sites need narrowing, but they are being rewritten in those phases
anyway — and narrowing forces each one to say which kind it assumes, which is
what makes a third kind safe to add. `{ kind: 'treemaker', project: <empty> }`
stays valid, so blank designs still work.

### `designMethod` is gone, not wrapped

The field is deleted from the store. Reads go through `selectDesignMethod(state)`,
writes through `withActiveTab(state, { kind })`. A derived selector cannot
disagree with the tab it describes, which is the same reason
`open-landing-and-design-state.md` collapsed `pendingDesignChoice` +
`workflowTarget` into one field in the first place.

## Phase 2b notes

### The compiler is not the backstop I claimed it was

Phase 2a's plan leaned on "delete the flat field and `tsc` enumerates every site".
That is true for *reads*. It is **false for writes into a slice's returned
literal**: `WorkspaceSliceCreator<T>` is `StateCreator<…, T>`, and excess-property
freshness does not survive that contextual typing. Verified rather than assumed —
adding `zzzBogusKey: 1` to `createEditingSlice`'s return still gives `tsc` exit 0.

So three dead flat fields (`project`, `lastOptimization`,
`designViewportFitRequestId`) and a whole dead `editingSlice` initial-state block
survived a clean typecheck. `designTabWrites.test.ts` now asserts at **runtime**
that no moved field exists at the top level of the assembled store — exact, and
the only mechanism that will hold for 2c's 41 `oristudioBp*` fields.

### Five bugs, and what found each

| Bug | Found by |
|---|---|
| `undoTree`/`redoTree`: two `designTabs` writers in one `set()` — the install silently discarded the restored history | a failing test, then a source scan that found **7 more** |
| `historyBusy` gates tree, crease-pattern *and* box-pleat undo; moving it onto the TreeMaker arm killed two of the three guards | the parallel audit |
| `projectStateFromSnapshot` became a full arm reset, but 5 of its call sites are lazy-handle syncs that fire mid-edit | the parallel audit |
| `initEngine` claimed `kind: 'treemaker'` on the startup chooser tab | the parallel audit |
| Dead flat fields surviving a clean typecheck | the runtime guard written after the audit |

None of the last four were reachable through the type system. The parallel
reconnaissance ran against the live worktree and read the half-migrated code,
which turned out to be far more useful than reading `HEAD` would have been.

### Two `designTabs` writers in one `set()`

The sharpest hazard of this shape. Both spread the same key, so the second wins
and the first vanishes — legal TypeScript, symptom remote from cause (undo
appearing to work while its history quietly resets). `projectStateFromSnapshot`
takes a `design` argument so the per-design fields ride *inside* the install
rather than beside it. `designTabWrites.test.ts` fails the build on a recurrence.

### `historyBusy`: one guard per surface, not one shared

Three independent undo systems read it. Scoped to the TreeMaker design it broke
both directions at once — with a design of another kind active the CP and BP
guards read a frozen `false` and stopped gating, and with a TreeMaker design
active a CP undo took the *tree's* guard and blocked tree undo. Now
`historyBusy` (tree), `oristudioCpHistoryBusy`, `oristudioBpHistoryBusy`.

The tree's is still flat rather than on the arm. Harmless — undo only runs
against the active design, so a workspace-level flag can only over-block — and
2d should move it onto the arm with addressed writes.

### Install vs sync

`installTreemakerDesign` claims the kind and rebuilds the arm from defaults;
right for a load or File ▸ New, catastrophic for `ensureTreeHandle`'s lazy
materialization, which fires during ordinary edits, pastes, condition changes and
exports. `syncTreemakerProject` patches instead, and omits the fold-artifact and
`sequence*` resets a real install carries — materializing a cold handle is not a
document swap. Five call sites repointed.

### `workspaceTitle`, split out of `project.title`

`project.title` was the *tree's* name and the *project's* name at once. Fine when
a workspace was one tree; incoherent once a project can hold a box-pleat design
and no tree at all. The tree keeps its title; `workspaceTitle` names the file, the
save dialog, and the export defaults. Without this, every box-pleat and
crease-pattern document would have saved as "Untitled".

### A crease pattern is not a design

Opening a bare `.cp` no longer populates a phantom tree. `CreasePatternPanel`'s
`hasCreasePattern` now names `importedCreasePattern` directly instead of
inferring it from `project.creases` — which also fixes the case where the CP
kernel fails to load and the imported document is the only evidence a pattern
exists. Same reasoning removed the `toolMode` / `symmetryAuthoringPairs` resets
from `freshEditableCpState`, whose own docstring already said it "deliberately
does NOT touch the tree/design fields".

## Affected areas

- `apps/web/src/designKinds/` — **new**: descriptors + registry
- `apps/web/src/store/workspaceStore/` — `engineRuntime.ts`, `oristudioBpRuntime.ts`,
  `types.ts`, `designVariant.ts` (deleted), `capabilities.ts`,
  `slices/{project,history,editing,oristudioBp}Slice.ts`
- `apps/web/src/store/layoutStore.ts` — variant machinery deleted
- `apps/web/src/components/panels/` — `DesignPanel.tsx`, `PanelComponents.tsx`,
  `DesignMethodChooser.tsx`, `InspectorPanel.tsx`, `DiagnosticsPanel.tsx`,
  `ConditionsPanel.tsx`, `BpEditorPanel.tsx`
- `apps/web/src/components/WorkspaceShell.tsx`
- `apps/web/src/keyboard/shortcutRuntime.ts`
- `apps/web/src/workspaces/` — `workspaces.ts`, `editingContext.ts`
- `apps/web/src/routing/` — `paths.ts`, `appRouter.tsx`, `WorkspaceRoute.tsx`,
  `landing.ts`, `workspaceUrlSync.ts`
- `apps/web/src/lib/` — `nativeProjectFile.ts`, `workspaceCapabilities.ts`,
  `oristudioCpLineage.ts` (deleted)
- `apps/web/src/analytics/events.ts`
- **No Rust changes** — both kernels are already handle-keyed
  ([treemaker-wasm/src/lib.rs:25](../crates/treemaker-wasm/src/lib.rs),
  [oristudio-bp-wasm/src/lib.rs:18](../crates/oristudio-bp-wasm/src/lib.rs))

## Checklist

- [x] Answer the five open questions — see "Resolved decisions"
- [ ] Land Phase 5 of `open-landing-and-design-state.md` (routing ownership)
- [x] Phase 0 — design-kind registry + two descriptors, no behavior change

  Landed: `apps/web/src/designKinds/` (types, registry, treemaker, boxPleat) plus
  three registry-driven consumers — capability masking, the method chooser, and
  `bpCpToEditorConvention` extracted to `lib/bpCreaseConvention.ts`. 41 new tests
  (registry invariants, stub-kind extensibility, capability-mask equivalence
  against the pre-registry rules, codecs against fake clients). Full suite
  2408/2408, typecheck, lint, i18n:check, and `build:web` all clean.

  Findings recorded below under "Phase 0 notes".
- [x] Phase 1 — document registry, lazy hydrate, LRU evict, pinning for in-flight work

  Landed: `apps/web/src/engines/engineHost.ts` (client ownership for the three
  persistent engines, with crash notification) and
  `apps/web/src/engines/documentRegistry.ts` (acquire / park / pinned / forget,
  LRU, engine-loss handling). `engineRuntime`, `oristudioCpRuntime`, and
  `oristudioBpRuntime` now get their clients from the host. 34 new tests. Full
  suite 2438/2438, typecheck, lint, i18n, `build:web` clean.

  Findings under "Phase 1 notes".
- [x] Phase 2a — design-tab container; `designMethod` deleted; ≥1-tab invariant

  Landed: `store/workspaceStore/designTabs.ts` plus the migration of all ~30
  `designMethod` sites. 22 new tests. Full suite 2460/2460, typecheck, lint,
  i18n, `build:web` clean. See "Phase 2a notes".

- [x] File ▸ New renamed to "New Project" + discard-guard coverage

      `dirty` is already workspace-level and `createNewProject` already guards on
      it, which is the right shape under "tabs are one project". Only the naming
      and the test coverage were missing.

- [x] Phase 2b — TreeMaker per-design state into the tab

  Landed: `designContent.ts` (the `kind`-discriminated content union) plus the
  accessors and writers in `designTabs.ts`. Eight fields moved onto the tab;
  `workspaceTitle` split out of `project.title`; `historyBusy` split into three
  per-surface guards. 2477 tests pass, typecheck, lint, i18n, `build:web` clean.

  See "Phase 2b notes" — five real bugs, four of which the compiler could not see.

      **Starting point for the next session.** Fields to move, as the
      `kind: 'treemaker'` arm: `project`, `selection`, `toolMode`,
      `symmetryAuthoringPairs`, `historyPast`/`historyFuture`/`historyBusy`,
      `lastOptimization`, `designViewportFitRequestId`.

      Two accessors, deliberately different in shape:

      - **Reads are total** — `selectProject(state)` returns the active design's
        tree, or an empty project when the active design is not a TreeMaker one.
        That is exactly today's meaning (a BP design already carries an empty
        `project`), so the ~80 read sites migrate mechanically and behaviour does
        not move. The union lives in *storage*; readers do not need narrowing.
      - **Writes are two operations** — `installTreemakerDesign(state, …)` sets
        the kind and the arm together (load/create paths), and
        `patchTreemaker(state, …)` updates an existing arm (edit paths, a dev
        warning + no-op if the active tab is not TreeMaker). Splitting them is
        what makes "kind without content" unrepresentable.

      Watch for: `saveNativeWorkspaceProject` decides `hasTree` from
      `project.nodes.length > 0`; that becomes a kind check, which is more
      correct but is a behaviour change worth its own test.
- [ ] Phase 2c — Box-Pleat per-design state into the tab (~41 sites)
- [ ] Phase 2d — addressed writes: capture the document id before the first `await`
- [ ] Phase 3 — Radix tab strip (add / close / rename / reorder / duplicate), ≥1 tab invariant
- [ ] Phase 4 — intra-tab Gridview, panes migrated, active-pane tracking
- [ ] Phase 5 — `/design` collapse with redirects
- [ ] Phase 6 — `.osf` v8, `minimumReaderSchemaVersion: 8`, migration, lineage removed
- [ ] Phase 7 — contexts, capabilities, shortcuts, undo per document
- [ ] Phase 8 — analytics (no names) + i18n
- [ ] Phase 9 — stub-kind test, evict/rehydrate equivalence, cross-tab undo isolation
