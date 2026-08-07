# One root cause behind three of these, and four smaller ones

## Goal

Six reports from using the ExplOri design kind. Three of them — undo doing
nothing, Delete doing nothing, and (earlier) the chooser opening the wrong kind —
are **the same bug in three places**, and there are more places it is still
hiding. The rest are four independent defects, two of which I introduced.

The point of this plan is the first part. Fixing the three arms one at a time is
the band-aid; the thing worth doing is making a kind that is registered actually
*be* registered.

## Root cause: kind dispatch is scattered, and the registry does not cover it

`designKinds/registry.ts` says adding a design kind should be adding one
descriptor, and `registry.test.ts` holds that claim to account with a stub kind.
It is true for what the descriptor covers — the chooser, capability masking, pane
layout, editing context, the codec. It is **false** for the command layer, which
switches on kind or editing context in at least five places the descriptor knows
nothing about:

| Where | What it decides | ExplOri arm |
| --- | --- | --- |
| `projectSlice.chooseDesignMethod` | which creator a chooser card runs | added earlier, after the card opened a TreeMaker design |
| `menuActions` `edit.delete` | which delete runs | added earlier |
| `workspaceCapabilities` `edit.delete` | whether Delete is *enabled at all* | **missing** — which is why the arm above never runs |
| `capabilities.historyCountForContext` | whether Undo/Redo are enabled | **missing** — returns 0, so both are greyed |
| `historySlice.undo` / `redo` | which history moves | **missing** — falls through to the tree undo, which refuses |

Every one of these was found by a user hitting it, one at a time, which is the
tell. The stub-kind test passes because it only exercises the descriptor's own
consumers.

Verified rather than assumed:

- `historyCountForContext(context, …)` has arms for `bp-tree`, `bp-packing`,
  `crease-pattern`, `treemaker-tree`, and `return 0` for everything else. So
  `edit.undo`'s predicate `input.historyPastCount > 0` is false for ExplOri and
  the command is disabled before it can dispatch.
- `edit.delete`'s predicate is `(isBpContext && …) || (!isBpContext && treeMode
  && …) || (canEditCp && …)`, where `treeMode` is
  `activeEditingContext === 'treemaker-tree'`. No arm is true in an ExplOri
  context, so the menu item is disabled and the router arm is unreachable.

### What to do about it

Two changes, in this order.

**1. Give the descriptor the two things the command layer keeps asking for.**
Both questions are per-kind facts a kind can answer about itself:

```ts
interface DesignKindDescriptor {
  // …
  /** Undo/redo depth for a design of this kind, so Edit can enable them. */
  history(state: WorkspaceState, designId: string): { past: number; future: number };
  /** What Delete would remove here, and the command that removes it. */
  deletion?: {
    target(state: WorkspaceState): unknown | null;
    delete(state: WorkspaceState, target: unknown): Promise<boolean>;
  };
}
```

Then `historyCountForContext`, the two capability predicates, `historySlice.undo`
/`redo`, and `menuActions` `edit.delete` all read the descriptor for the active
context instead of listing kinds. TreeMaker and box-pleat move onto it too, so
there is one path rather than one path plus a special case.

**2. Extend the stub-kind test to the command layer.** The existing test proves a
stub kind reaches the chooser and the capability mask. It should also prove that
a stub kind's Undo, Redo and Delete are enabled and dispatch — because that is
precisely the claim that turned out to be false, three times, in the places no
test looked.

`chooseDesignMethod` is the remaining switch after this. It is a creator rather
than a query, so folding it in means the descriptor growing a `create()` beside
its codec; worth doing but separable, and noted rather than done here.

## The other four

### 3. A leaf near the mirror is neither centred nor mirrored — a bug

Measured: with the snap lane drawn 18px wide, a click **6px from the axis**
produced a node at `x = 0.107` with `pairs: []`. So it was treated as on-axis —
which is why it got no twin — while being left sitting beside the axis.

`addExploriLeaf` asks `symmetrySide(loc, axis, tolerance) === 0` to decide
*whether* to mirror, and never moves `loc` onto the axis. Box-pleat's equivalent
action snaps first (`snapPointToSymmetryAxis`) and then decides; the ExplOri port
kept the test and dropped the snap. The editor's ghost *does* snap, so the
preview and the commit disagree — the exact failure the tree pane's own notes
warn about ("the hover ghost and the click can't disagree about where the leaf
would land").

Fix: snap in the slice, as box-pleat does, and take the length from the parent
along the axis rather than from the raw projection — projecting a tip onto the
axis shortens the edge by its horizontal component, which is how a centred leaf
ends up shorter than the one the ghost drew.

While there: `CONTINUOUS_LENGTHS.min` is `1e-3`, so a click near its parent makes
a flap a thousandth of a unit long. That is not a length anyone means; a floor
around a tenth of a unit is.

### 4. Box-pleat opens with its flaps bunched — a regression I caused

Fixing the view drift, I moved box-pleat's world from the tree's content bounds
to the sheet. The world had to become fixed — that was the drift — but the
*camera* then framed the whole 20×20 sheet instead of the tree, so a starter
design opens small. `maxFitScale` does not help: it caps zooming in, and this
needs a floor.

The seam is that `useViewportSurface` fits to `worldRect` because it has nothing
else. Give it an optional `fitRect`: the world stays fixed (no drift) and the
opening camera frames the content (no bunching). Box-pleat passes its content
bounds, ExplOri its own, and the two concerns stop being the same number.

### 5. Escape does not deselect

Characterised: dispatched on the pane container it clears the selection;
dispatched at the window it does nothing. The listener is a container-scoped
`keydown`, so it is dead whenever focus is anywhere else — the name field, the
results pane, the query bar, a toolbar button.

This is the item the Phase 0 plan listed and I deferred ("Move the container
Escape listener into `keyboard/`"), and it is deferred no longer. It goes in the
shortcut registry as a viewport shortcut, which is focus-independent by
construction and is what `AGENTS.md` requires of any keyboard shortcut. Box-pleat
gets the same fix, since it is the same listener.

### 6. Result count should default to 5

`DEFAULT_RESULT_LIMIT` is 8; upstream's is 5.

### 7. Match quality should read as a scale

Upstream gives each of the five a colour and wears it as a tinted pill — green
through amber to red — so a grid of results reads at a glance. Ours colours two
of the five and leaves the rest as grey text, which is why it does not read as a
ramp. Take upstream's five hues, mapped onto our tokens, as a bordered pill.

## Affected Areas

- `apps/web/src/designKinds/types.ts`, `treemaker.ts`, `boxPleat.ts`,
  `explori.ts` — the two new descriptor fields
- `apps/web/src/store/workspaceStore/capabilities.ts`,
  `lib/workspaceCapabilities.ts` — read the descriptor
- `apps/web/src/store/workspaceStore/slices/historySlice.ts`,
  `commands/menuActions.ts` — dispatch through the descriptor
- `apps/web/src/designKinds/registry.test.ts` — the stub kind must undo and delete
- `apps/web/src/store/workspaceStore/slices/exploriSlice.ts` — snap on add
- `apps/web/src/tree-editor/lengths.ts` — a floor a person means
- `apps/web/src/hooks/useViewportSurface.ts` + both hosts — `fitRect`
- `apps/web/src/keyboard/` + `tree-editor/TreeEditor.tsx` — Escape
- `apps/web/src/explori/document.ts` — default of 5
- `apps/web/src/explori/matchQuality.ts`, `styles/theme.css` — the colour ramp

## Checklist

- [ ] Descriptor answers `history` and `deletion`; every kind implements them
- [ ] Capabilities, history slice and menu actions read the descriptor instead of
      listing kinds
- [ ] Stub-kind test covers Undo, Redo and Delete — the claim that was false
- [ ] ExplOri undo/redo and Delete work, with tests that fail against today
- [ ] A leaf inside the snap lane lands *on* the axis, at the length the ghost
      drew, and gets no twin; one outside it gets a twin
- [ ] Continuous lengths floor at a length someone means
- [ ] `fitRect` separates the fixed world from the framed content; box-pleat
      opens at its old size and still does not drift
- [ ] Escape deselects from the shortcut registry, on both tree surfaces
- [ ] Result limit defaults to 5
- [ ] Match quality is a five-step colour ramp
- [ ] Lint, typecheck, tests, `i18n:check`
- [ ] Browser-verify each
