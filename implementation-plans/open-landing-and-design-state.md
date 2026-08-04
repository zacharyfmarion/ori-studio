# One source of truth for open-landing and design state

## Goal

Opening a project lands in the right workspace, and the states that would make it
land in the wrong one stop being representable.

Four facts are each stored, derived, or decided in more than one place today, and
each duplication has already produced a shipped bug:

| Duplicated fact | Copies | Bug it produced |
|---|---|---|
| "what path represents the current state" | 3 | a design-only file opens on the method chooser |
| "which design method is active" | 2 fields + 2 converters | the chooser can contradict a loaded design |
| "how to install a crease pattern from an `.osf`" | 2 | saved crease colours and grid/snap settings are lost |
| "where the user should be after a load" | decided N times per load, from partial state | the BP workspace flashes for ~150 ms mid-open |

The aim is not to fix the four bugs. It is to remove the duplication so they
cannot recur — after this, each fact has exactly one producer, and `grep` proves
it.

## Current state (the evidence)

### 1. Three functions answer "what path is the current state"

- `openedProjectPath()` — [routing/landing.ts:8](../apps/web/src/routing/landing.ts) —
  derives a path from **which documents exist**.
- `targetPath()` — [routing/workspaceUrlSync.ts:11](../apps/web/src/routing/workspaceUrlSync.ts) —
  derives it from **`activeWorkspace` + the design variant**.
- `railPath()` — [components/WorkspaceShell.tsx:60](../apps/web/src/components/WorkspaceShell.tsx) —
  byte-identical logic to `targetPath()`.

The first disagrees with the other two. For any project with no crease pattern it
returns bare `/design`, which is the **method-chooser sub-route**, not the Design
workspace generally. Landing there runs `applyDesignRoute('nux')` (from both
[WorkspaceRoute.tsx:27](../apps/web/src/routing/WorkspaceRoute.tsx) and
[WorkspaceShell.tsx:303](../apps/web/src/components/WorkspaceShell.tsx)), which sets
`pendingDesignChoice: true` — overwriting the `pendingDesignChoice: false` /
`workflowTarget: 'box-pleat'` that `setLoadedBpProject` wrote moments earlier.

Reproduced in-browser against a real BP-only `.osf`:

```
after openProject   hasBp: true, workflowTarget: "box-pleat", pendingDesignChoice: false
openedProjectPath()  "/design"
after navigating     hasBp: true, pendingDesignChoice: true, page reads "Start a new design"
```

The design was never lost — the route told the store to forget one had been
chosen. Then the chooser's "Box-pleated" card runs `chooseDesignMethod` →
`createOristudioBpProject`, which unconditionally installs the starter project
with `confirmDiscard: false`: `currentFileName` goes `large_tree.osf` →
`Untitled.bps`, no prompt.

It is **entry-point dependent**, which is the tell:

| Entry point | Post-open navigation | Result |
|---|---|---|
| File ▸ Open (menu) | none — the URL sync handles it | ✅ `/design/bp` |
| Start screen "Open" | [WelcomeRoute.tsx:66](../apps/web/src/routing/WelcomeRoute.tsx) | ❌ `/design`, chooser |
| Drag-and-drop | [fileDropController.ts:196](../apps/web/src/commands/fileDropController.ts) | ❌ `/design`, chooser |
| Finder open-with | [App.tsx:144](../apps/web/src/App.tsx) | ❌ `/design`, chooser |

The one path that does not call `openedProjectPath()` is the one that works.
Opening a *second* time appears to work only because the router is already at
`/design`, so `WorkspaceRoute`'s effect (deps `[workspace, variant]`) never
re-runs.

Not BP-specific: a tree-only `.tmd5` does the same thing. BP exposes it because
BP projects usually carry no crease-pattern companion, while TreeMaker projects
usually do (→ `/edit`, masking it).

### 2. The design variant is stored as two contradictable fields

`{ pendingDesignChoice: boolean, workflowTarget: 'treemaker' | 'box-pleat' }`,
with a forward converter (`deriveDesignVariant`) and a backward writer
(`applyDesignRoute`). Neither field owns the fact.

The combination `pendingDesignChoice: true` **while a BP document is loaded** is
representable, and that state *is* the bug above. Fixing the landing removes the
trigger; it does not remove the ability to re-create it. The mitigation already
exists in the codebase and names the hazard out loud —
[WorkspaceShell.tsx:56](../apps/web/src/components/WorkspaceShell.tsx):

> Design targets its active variant sub-route (so an in-progress design isn't
> bounced back to the method chooser)

That comment is the third path producer's whole reason to exist.

Surface is small and heavily overlapping — `WorkspaceShell`, `DesignPanel`,
`BpEditorPanel`, `designVariant.ts`, `freshCreasePattern.ts`, `projectSlice.ts`,
`editingContext.ts`; ~29 references to `pendingDesignChoice` and ~30 to
`workflowTarget` including writes.

### 3. The two crease-pattern install paths have drifted again

`loadNativeCreasePattern` (the CP is the whole project) and
`restoreNativeCreasePatternCompanion` (the CP rides along with a design) both
install an Edit canvas from an `.osf`. Diffing their `set()` blocks on `main`, and
excluding fields that legitimately belong only to the CP-only case (`project`,
`pendingDesignChoice`, `status`, `currentFileName`, `importedCreasePattern`,
`sequence*`, `dirty`, `lastOptimization`), the companion path is **missing**:

- `creaseColorMode` — saved crease colours revert on reopen
- `oristudioCpViewport` (and its defaults spread) — grid, snaps, line width lost
- the `projectLoadId` bump — the CP panel and undo stack are not re-baselined
- `toolMode` — not reset to `select`

**This is a live bug on `main` today**, independent of the routing one: open an
`.osf` holding a design plus a crease pattern and the crease pattern comes back
with its view settings reverted. Neither is persisted in localStorage, so they are
genuinely lost.

It was diagnosed in July and never fixed. Since then inline simulations were added
to *both* paths — someone saw the pattern and still did not close the divergence.
That is the argument for structural prevention, made by the repo itself.

Precedent for the fix already exists: `freshCreasePattern.ts` is exactly this
shape (one exported state factory shared by the blank-canvas paths) and its own
comment records the same class of bug.

### 4. A load has no commit boundary, so observers act on half-installed state

Measured on one `.osf` open (BP design + crease-pattern companion, opened from a
mounted Edit workspace):

- **18 store notifications** for a single open.
- `oristudioCpDocument` takes **four** values on the way through:
  `null` → a self-provisioned blank → `null` → the real companion.
- **11 of 14** `activateWorkspace` call sites live inside store slices — the layer
  that should have no opinion about where the user is.
- `activateWorkspace` is `saveLayout` → `dockviewApi.clear()` → `fromJSON`
  ([layoutStore.ts:255](../apps/web/src/store/layoutStore.ts)) — a full teardown
  and rebuild, which runs **twice** per bundle open.

Every observer treats each intermediate state as final and takes an irreversible
action on it. Timeline, with wrapped actions and stack traces:

```
t=  28  clearOristudioCpDocument()          outgoing canvas released
t=  78  ensureEditCreasePattern() CALLED    Edit panel effect sees "no CP", provisions a blank one
t=  84  cpDocument=true                     …that document is thrown away at t=448
t= 448  cpDocument=false                    loadOristudioBpProjectFromFile clears the canvas
t= 450  WORKSPACE edit -> design            setLoadedBpProject tail: activateWorkspace('design')
                                            URL -> /design/bp, panels -> bp-editor,design
t= 634  cpDocument=true                     the bundle's companion CP finally lands
t= 672  WORKSPACE design -> edit            applyLandingWorkspace corrects it; URL -> /edit
```

Two separable defects:

- **No commit boundary.** `ensureEditCreasePattern` builds a crease pattern during
  a 370 ms window where the truth is "a crease pattern is arriving shortly."
- **Installers navigate.** `setLoadedBpProject` both installs the BP document *and*
  calls `activateWorkspace('design')`
  ([oristudioBpSlice.ts:223](../apps/web/src/store/workspaceStore/slices/oristudioBpSlice.ts)),
  so the destination is chosen from a project that is half installed. "Design" is
  correct *for the state that exists at that instant* — the companion crease
  pattern does not exist yet. It only becomes wrong 184 ms later.

User-visible cost: the BP workspace flashes for ~150 ms, and the intermediate
`/design/bp` is **pushed to browser history** (`history.length` 21 → 23; Back
after an open lands on `/design/bp`).

Phase 1 did not fix this — it added a *second* decision at the end, and the flash
is the two decisions disagreeing out loud. Before Phase 1 the File ▸ Open path
never took the second decision, so it silently stayed in the wrong workspace; the
drop and desktop open-with paths already flashed.

The codebase already contains local patches for the missing rule —
`preserveEditCanvas`, `freshCreasePattern.ts`, and `workspaceUrlSync` itself,
whose own comment is the confession:

> Rather than rewrite each one to navigate, this subscription observes the
> resulting `activeWorkspace` change and points the URL at the matching path.

`workspace-routing.md` originally specified that a single route effect would be
"the **only** place that drives workspace/variant state". The sync is the patch
over that drift, not the design.

### Prior art: an earlier fix that never landed

`.claude/worktrees/file-opens-wrong-tab-09e7b0` holds an uncommitted 2026-07-27
attempt at most of this, plus an untracked
`implementation-plans/osf-open-landing-workspace.md`. It was never committed —
`git log --all -S currentWorkspacePath` finds nothing — and `main` is now **316
commits** ahead of its base.

Do **not** `git apply` it. 6 of 9 files fail, and the failures are not all
mechanical: both schema bumps since (`8516cc33` inline simulation windows → v5,
`0237e017` BP symmetry → v6) landed *inside* the functions it rewrites, so its
`nativeCpEditorState()` predates `oristudioCpInlineSimulations`,
`discardCpDocumentState()`, `staleFoldArtifactResourceState()` and the
`hydrateOristudioCpInlineSimulations()` kick. Lifting it would silently drop
inline simulations — reintroducing the very class of bug it exists to prevent.
`fileDropController.ts` also did not exist then.

Its **ideas** are right and this plan keeps three of them: one path producer, one
landing rule, one CP installer. Its `landingWorkspace.ts` transplants verbatim.
Its tests transplant, including one that asserts exactly the bug above
(`expect(currentWorkspacePath()).toBe('/design/bp')`). Everything touching
`projectSlice`/`nativeProjectFile` is re-derived from today's field set, not
lifted.

## Approach

Four independent phases, each removing one duplication. No phase depends on
another; the numbering is roughly by risk.

**Recommended execution order: 1 ✅ → 4a → 2 → 3 → 4b → 4c.** Phase 4a comes early
because the flash is live and user-visible today, and it is the cheapest item in
the plan. 4b and 4c are the endgame and are worth doing only once the earlier
phases have stopped adding call sites.

**Phase 1 — one path producer.** Replace `openedProjectPath()` with
`currentWorkspacePath()`, which reflects `activeWorkspace` + variant rather than
re-deriving from documents. `workspaceUrlSync.targetPath()` and
`WorkspaceShell.railPath()` both delete and import it. Add `landingWorkspace()`
(CP present → Edit, else Design) as the single rule every open path applies, via
an `applyLandingWorkspace()` step in `openProject`. Afterwards, exactly one
function in the codebase produces a workspace path.

**Phase 2 — one crease-pattern installer.** Extract `nativeCpEditorState()`: the
complete set of Edit-canvas fields restored from a saved CP document, spread by
both install paths. Scoped to the Edit canvas — it must not touch `project`,
`pendingDesignChoice`, `status`, or the fold artifacts, so it can install a CP
alongside a design without unclaiming it. Derived from today's two `set()` blocks,
field by field.

**Phase 3 — one design-method field.** Collapse
`{ pendingDesignChoice, workflowTarget }` into:

```ts
designMethod: 'none' | 'treemaker' | 'box-pleat'
```

`deriveDesignVariant()` then deletes — the field *is* the variant. And make
`/design` **redirect-only rather than a writer**: when `designMethod !== 'none'`
it redirects to that method's path; the chooser renders only when the method
genuinely is `'none'`. That removes the last writer able to contradict the
documents, and `railPath`'s special case disappears with it.

`startNewDesign()` (start screen ▸ "Start a new design") becomes the one
legitimate writer of `'none'` — an explicit user request for the chooser.

Honest limit: `designMethod` cannot be fully *derived* from the documents, because
a blank TreeMaker tree has no content — the codebase already notes this in
`chooseDesignMethod`. It stays stored. But one field with three states cannot
self-contradict the way two fields can.

**Phase 4 — a load is a transaction.** The rule the codebase is missing, stated
once: *build off to the side, commit once, decide where to go once from the
committed state.* Three steps, each shippable alone:

- **4a — installers install; they never navigate.** Delete `activateWorkspace`
  from the 11 slice call sites. A loader returns what it produced; `openProject`
  makes the single landing decision it already makes today. This alone removes
  the flash and the junk history entry, because there is no longer a first
  decision to disagree with. It is the July work's `showBpDesignWorkspace` split,
  generalized from the BP loader to all four.
- **4b — a load builds, then commits once.** `loadNativeProject` parses and builds
  every document the file holds — all the async engine work — and installs them in
  one `set()`. The store goes old-project → new-project with nothing observable
  in between, so `ensureEditCreasePattern` cannot fire into the gap and build a
  document that is discarded 370 ms later. This is the July additive-loader work,
  re-derived against today's field set (see the prior-art warning above).
- **4c — the URL is the only thing that moves the user.** `activateWorkspace`
  becomes private to the route layer; everything else navigates. This **deletes**
  `workspaceUrlSync` rather than adding to it, and restores what
  `workspace-routing.md` specified. It is the only step in this plan that removes
  a mechanism instead of adding one.

Honest cost on 4b: the engine is handle-based. `restoreOristudioCpDocument`
allocates a wasm handle and frees the one it supersedes, and `loadTreeFromText`
mutates the live tree handle, so building fully detached means holding old and new
at once — higher peak memory, against a known WKWebView OOM on large `.osf`
([desktop-large-cp-osf-oom]). Measure peak memory on a large bundle before
committing to it; a partial version (build the CP detached, install the design in
place) may be the right trade.

### Out of scope: restoring the focused pane

The July work also persisted `workspace.viewState.activePanelId` so a bundle
reopened on the pane it was saved in. **Deliberately dropped** (author's call).
Files land by the documents-derived rule alone, which means a design bundled with
a crease pattern always reopens on Edit.

Dropping it avoids: `nativeFocus.ts` (two functions + 9 tests), a schema field and
its validation, `focusNativeProject` and its ordering trap (`ensureDesignLayout`
must run before `activatePanel` or the BP Editor pane is not yet mounted), and the
"recorded pane has no document behind it" fallback.

Note this is a behaviour change for existing files, and it is what `landingWorkspace()`
already implies — worth stating in release notes.

Also out of scope, tracked separately: `chooseDesignMethod` installs a fresh
starter with `confirmDiscard: false`, so it can replace a loaded design without a
prompt. Phase 3 removes the accidental route to it; the missing prompt is its own
change (and needs 8 locales if a new string is added).

## Affected Areas

- `apps/web/src/routing/landing.ts` — `openedProjectPath` → `currentWorkspacePath`
- `apps/web/src/routing/workspaceUrlSync.ts` — delete `targetPath`, import instead
- `apps/web/src/routing/WorkspaceRoute.tsx` — `/design` stops writing (Phase 3)
- `apps/web/src/routing/paths.ts` — `workspacePath` becomes internal to the above
- `apps/web/src/components/WorkspaceShell.tsx` — delete `railPath`; drop the
  `onReady` copy of `applyDesignRoute`
- `apps/web/src/App.tsx`, `apps/web/src/routing/WelcomeRoute.tsx`,
  `apps/web/src/commands/fileDropController.ts` — the three navigation call sites
- `apps/web/src/store/workspaceStore/landingWorkspace.ts` (new)
- `apps/web/src/store/workspaceStore/designVariant.ts` — deleted by Phase 3
- `apps/web/src/store/workspaceStore/slices/projectSlice.ts` —
  `applyLandingWorkspace`, `nativeCpEditorState`, `applyDesignRoute`,
  `startNewDesign`, `setWorkflowTarget`
- `apps/web/src/store/workspaceStore/slices/oristudioBpSlice.ts`,
  `slices/creasePatternSlice.ts`, `freshCreasePattern.ts`,
  `workspaces/editingContext.ts`, `store.ts` — `designMethod` reads/writes
- `apps/web/src/components/panels/DesignPanel.tsx`,
  `components/panels/BpEditorPanel.tsx` — `designMethod` reads

## Verification

Per-phase, tool-checkable. Run the tools directly — `npm run typecheck:web`
regenerates tracked `generated/**` wasm bindings nondeterministically:

```bash
cd apps/web && npx tsc --noEmit && npx vitest run
```

Browser checks (author-verified): open `large_tree.osf` from the start screen, from
a drop, and from Finder open-with; each should land on the BP editor. Open an
`.osf` holding a design plus a crease pattern with a non-default crease colour
mode and grid settings; both should survive the round trip.

## Checklist

### Phase 1 — one path producer ✅
- [x] Add `landingWorkspace.ts` (transplanted from the July worktree) + its 4 tests
- [x] Replace `openedProjectPath()` with `currentWorkspacePath()` in `landing.ts`
- [x] Delete `targetPath()`; `workspaceUrlSync` imports `currentWorkspacePath`
- [x] Delete `railPath()`; `WorkspaceShell` imports `pathForWorkspace`
- [x] Update the three call sites: `App.tsx`, `WelcomeRoute.tsx`, `fileDropController.ts`
- [x] Add `applyLandingWorkspace()` to `openProject` — applied to **every** format,
      not just non-native: with focus restore out of scope there is no reason for
      `.osf` to take a different path
- [x] Fix the hazard this exposed: `loadText` installed a tree without claiming the
      design fields, so a previous file's `workflowTarget` and BP document survived.
      Harmless while every design landed on bare `/design`; a variant-aware landing
      would have sent a freshly-opened tree to `/design/bp`
- [x] Test: `currentWorkspacePath() === '/design/bp'` after opening a BP-only `.osf`
- [x] Test: a tree replacing a BP design → `/design/treemaker`
- [x] Test: a design + CP bundle lands on `/edit`
- [x] `grep -rn "workspacePath\|designVariantPath" apps/web/src` shows one producer

### Phase 2 — one crease-pattern installer
- [ ] Extract `nativeCpEditorState()` from today's two `set()` blocks, field by field
- [ ] Both `loadNativeCreasePattern` and the companion path spread it
- [ ] Confirm it carries `creaseColorMode`, `oristudioCpViewport`, `projectLoadId`,
      `toolMode`, `oristudioCpInlineSimulations`, `discardCpDocumentState()`,
      `staleFoldArtifactResourceState()`
- [ ] Keep the `hydrateOristudioCpInlineSimulations()` kick on both paths
- [ ] Test: crease colour mode + viewport survive a design-plus-CP round trip
- [ ] Document the scope rule in the function comment (Edit canvas only)

### Phase 3 — one design-method field
- [ ] Add `designMethod`; migrate all reads off `pendingDesignChoice`/`workflowTarget`
- [ ] Delete `deriveDesignVariant()` and `designVariant.ts`; update `registerDesignVariantSource`
- [ ] `/design` becomes redirect-only: non-`'none'` → that method's path
- [ ] `applyDesignRoute` no longer writes for the `nux` case
- [ ] Remove the duplicate `applyDesignRoute` call in `WorkspaceShell.onReady`
- [ ] `startNewDesign()` is the only writer of `'none'`
- [ ] Test: navigating to `/design` with a design loaded redirects, does not reset
- [ ] Test: `startNewDesign()` still reaches the chooser

### Phase 4 — a load is a transaction
**4a — installers never navigate** (do this next; the flash is live)
- [ ] Remove `activateWorkspace` from `setLoadedBpProject`, `loadText`,
      `loadCreasePattern`, `loadNativeCreasePattern` (11 slice call sites total)
- [ ] `createOristudioBpProject` / `loadOristudioBpExample` navigate explicitly at
      their own call sites (the July `showBpDesignWorkspace` shape)
- [ ] Confirm `openProject`'s `applyLandingWorkspace` is the only decision left
- [ ] Test: opening a design+CP bundle produces exactly **one** `activeWorkspace`
      transition and **one** history entry
- [ ] Browser: no BP flash; Back after an open does not land on `/design/bp`

**4b — one commit per load**
- [ ] Measure peak memory on a large bundle first — decide full vs partial detach
- [ ] `loadNativeProject` builds every document, then installs in one `set()`
- [ ] Re-derive against today's fields (inline simulations, symmetry, schema 6)
- [ ] Test: one open publishes a bounded number of store notifications (18 today)
- [ ] Test: `oristudioCpDocument` changes **once** per open, not four times
- [ ] Confirm `ensureEditCreasePattern` no longer fires during a load

**4c — the URL is the only driver**
- [ ] `activateWorkspace` private to the route layer; all other callers navigate
- [ ] Delete `workspaceUrlSync` and its loop guards
- [ ] Audit the non-loader callers (`SequencePanel`, `activatePanel`, menu actions)
- [ ] Test: workspace changes are always driven by a route, never observed after

### Close-out
- [ ] `npx tsc --noEmit`, `npx vitest run`, `npm run lint:web`
- [ ] Browser pass over the four open entry points
- [ ] Add the rule to `AGENTS.md`: *a load is a transaction — build off to the
      side, commit once, decide where to go once from the committed state*
- [ ] Delete the superseded `.claude/worktrees/file-opens-wrong-tab-09e7b0` (author's call)

## Risks

- **Phase 3 touches the editing context.** `resolveEditingContext` reads both
  fields; a wrong mapping silently changes which menus, shortcuts, and history
  stack are live. Land it separately from 1 and 2.
- **`activateWorkspace` is destructive** — it saves the layout, clears Dockview,
  and rebuilds from JSON, churning the WebGL canvas. Avoid double calls when
  moving the landing logic.
- **Folded-figure handles** are freed only by `clearOristudioCpFoldedFigures()`;
  `restoreOristudioCpDocument` frees the document handle but not those. Any change
  to CP install ordering must keep the clear.
- **Behaviour change** for existing `.osf` files: a design bundled with a crease
  pattern now reopens on Edit. Intentional; note it in release notes.
- **4b trades latency for peak memory.** Building detached holds two copies of the
  crease pattern; large bundles are exactly where the desktop already OOMs. Measure
  before choosing full vs partial detach.
- **4c touches every workspace switch in the app**, not just loads — the widest
  blast radius here. Worth doing only after 4a and 4b stop adding call sites.
