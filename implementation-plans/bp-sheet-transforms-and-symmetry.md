# BP Sheet Transforms and Symmetry

## Goal

Surface Box Pleating Studio's Edit-menu sheet operations — **Subdivide grid**,
**Rotate right**, **Rotate left**, **Horizontal flip**, **Vertical flip** — in the
Design workspace, and make every one of them correct when mirror symmetry is on.

Upstream is `third_party/box-pleating-studio/src/app/vue/toolbar/editMenu.vue`,
which calls `sheet.subdivide()`, `sheet.rotate(±1)` and `sheet.flip(h)` in
`src/client/project/components/sheet.ts:210-245`.

### State of play

Most of this is already built. The gap is narrower than the menu suggests:

| Upstream op | Kernel | wasm | worker | runtime | store action | UI |
| --- | --- | --- | --- | --- | --- | --- |
| Subdivide | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ Design menu |
| Un-subdivide (ours, no upstream) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ Design menu |
| Rotate right / left | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ **no caller** |
| Horizontal / vertical flip | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ **no caller** |

`rotateOristudioBpLayoutSheet` and `flipOristudioBpLayoutSheet`
([oristudioBpSlice.ts:1265](apps/web/src/store/workspaceStore/slices/oristudioBpSlice.ts:1265))
have zero callers anywhere in the app. They were toolbar buttons on the old
`BpEditorPanel` — `box-pleating-editor-parity.md` Phase 5 ticks them off against
that pane — and the Design-workspace rewrite did not carry them across. The
command descriptors survived the move
([oristudioBpCommands.ts:626-672](apps/web/src/lib/oristudioBpCommands.ts:626))
but have no capability, no menu entry and no dispatch case.

So the mechanical work is **re-surfacing four dead store actions**. The real work
is the second half of the goal.

### Why symmetry is the actual problem

None of the four transforms is symmetry-aware, and two of them break the
recorded symmetry outright.

The layout-space mirror is **derived, not stored**
([bpOptimizerSymmetry.ts:83](apps/web/src/lib/bpOptimizerSymmetry.ts:83)):

```ts
axis = optimizerSymmetryAxisForFold(sheet.kind, fold)   // 'verticalHalf' | 'mainDiagonal'
```

Two inputs, and the output can only ever be one of **two** of the four axes the
rest of the stack understands. That was a deliberate simplification — the
docblock says so: *"Each fold has a second variant … but they are the same
problem rotated a quarter turn, so only one is offered."* The transforms land
squarely on the variant that is not offered:

| Op | verticalHalf → | mainDiagonal → | Representable today |
| --- | --- | --- | --- |
| Subdivide / un-subdivide | verticalHalf | mainDiagonal | ✅ uniform scale about the centre commutes with reflection |
| Rotate ±90° | **horizontalHalf** | **antiDiagonal** | ❌ |
| Horizontal flip | verticalHalf | **antiDiagonal** | ❌ for a diagonal fold |
| Vertical flip | verticalHalf | **antiDiagonal** | ❌ for a diagonal fold |

The consequence is not cosmetic. After a rotate, the design really is mirrored
about the horizontal, but `bpPackingSymmetryAxis` still answers `verticalHalf`,
so:

- the mirror line is drawn across the wrong diagonal of the sheet,
- `constrainBpFlapGroupToAxisSides` clamps flaps against a mirror that isn't
  there, pinning them to the wrong half of the paper,
- `buildMirroredBpFlapMoves` sends every partner to a reflected position that is
  not where its partner is, so the first drag after a rotate tears the design
  apart,
- `resolveOptimizerSymmetry` hands the kernel the wrong `axis`, and the optimizer
  solves for a symmetry the design does not have.

**Nothing in the kernel is wrong.** The transform is a rigid motion of the whole
layout; the geometry preserves symmetry by construction. What breaks is only our
*record of where the mirror is*, which lives entirely in the frontend. This plan
therefore touches no Rust — and so needs no wasm rebuild (see the AGENTS.md note
about tracked artifacts under `apps/web/src/generated/oristudio-bp-wasm/`).

## Approach

### Phase 0 — Give the mirror a quarter turn

Add one bit to `BpDocumentSymmetry`
([bpTreeSymmetry.ts:85](apps/web/src/lib/bpTreeSymmetry.ts:85)):

```ts
export interface BpMirrorOrientation {
  fold: SymmetryFold;
  /** Whether the fold's mirror sits a quarter turn off its canonical placement. */
  quarterTurn: boolean;
}

export interface BpDocumentSymmetry extends BpMirrorOrientation {
  enabled: boolean;
  pairs: BpTreeSymmetryPair[];
}
```

and widen the derivation:

```ts
export function optimizerSymmetryAxisForFold(
  sheetKind: OristudioBpSheetKind,
  mirror: BpMirrorOrientation
): OptimizerSymmetryAxis {
  const alongGrid = sheetKind === 'diagonal' ? mirror.fold === 'diagonal' : mirror.fold === 'book';
  const base = alongGrid ? 'verticalHalf' : 'mainDiagonal';
  if (!mirror.quarterTurn) return base;
  return base === 'verticalHalf' ? 'horizontalHalf' : 'antiDiagonal';
}
```

**Why a bit alongside the fold rather than storing the resolved axis.** The
square's four mirror axes fall into two classes of two: book (vertical,
horizontal) and diagonal (main, anti). `fold` names the **class** — which kind of
symmetry the model has — and a quarter turn maps book→book and diagonal→diagonal,
so the class is rotation-invariant. `quarterTurn` names the **member** within the
class. Two independent coordinates for two independent facts, which is why the
existing docblock's *"each fold has a second variant … only one is offered"* is
exactly the missing bit.

The class also has to stay derived: a book fold of the paper *is* a grid diagonal
once the paper is placed as a diamond, and `optimizerSymmetryAxisForFold` already
re-reads `sheet.kind` to say so. Persisting `axis` directly would double-encode
the sheet kind and go stale the moment someone uses `bp.layout.changeGridType`.

A consequence worth stating so nobody "fixes" it later: **`setFold` must not
touch `quarterTurn`.** Choosing book vs diagonal is choosing the class, not the
line, so a fold pick leaves the orientation alone — and the menu's label stays
true either way, since a horizontal mirror is still a book fold. The existing
one-field patch (`setOristudioBpSymmetry({ fold })`) already does the right
thing; leave it that way.

Take the parameter as `BpMirrorOrientation`, not as two positional arguments:
the type change makes the compiler enumerate every call site, which is the point.

Everything downstream **already handles all four axes** — `axisEndpoints`
([useBpPackingSymmetry.ts:92](apps/web/src/hooks/useBpPackingSymmetry.ts:92)),
`mirrorBpFlapAnchor`, `projectBpFlapAnchorOntoAxis`, `axisUnitNormal`,
`bpPackingSheetSupportsAxis`, `optimizerSymmetryAxisSwapsDimensions`, and the
kernel's own `SymmetryAxis` (`crates/oristudio-bp/src/optimizer.rs:69`, all four
variants, `camelCase` serde). Only the derivation narrows.

Persistence and history:

- `defaultBpDocumentSymmetry()` → `quarterTurn: false`.
- `validateBpDocumentSymmetry()` → `typeof record.quarterTurn === 'boolean' ? … : false`,
  in the existing lenient style; a file that predates the field reads as `false`,
  which is exactly what it meant.
- `bpDocumentSymmetry()` narrowing helper carries it.
- `.osf` read/write in `nativeProjectFile.ts` (the symmetry blocks at `:606` and
  `:1281`).
- Undo needs no change: `runBpTreeMutation` already snapshots the whole
  `BpDocumentSymmetry` before the operation
  ([oristudioBpSlice.ts:489](apps/web/src/store/workspaceStore/slices/oristudioBpSlice.ts:489)),
  so a restored snapshot restores the orientation with it. Assert it in a test
  rather than assuming it.
- `.bps` export is unaffected — Box Pleating Studio's format carries no symmetry
  block, and ours lives only in `.osf`.

### Phase 1 — Make the transforms move the mirror

One pure function, next to the packing symmetry math, with the whole rule in one
table:

```ts
// apps/web/src/lib/bpPackingSymmetry.ts
export type BpSheetTransform = 'subdivide' | 'unsubdivide' | 'rotate' | 'flip';

export function mirrorAfterSheetTransform(
  sheetKind: OristudioBpSheetKind,
  mirror: BpMirrorOrientation,
  transform: BpSheetTransform
): BpMirrorOrientation;
```

- `subdivide` / `unsubdivide` → unchanged. A uniform scale about the sheet centre
  commutes with every reflection through that centre.
- `rotate` (either direction) → toggle `quarterTurn`. A quarter turn maps
  `verticalHalf ↔ horizontalHalf` and `mainDiagonal ↔ antiDiagonal`; both
  directions give the same unordered axis, so the sign does not matter.
- `flip` (either direction) → toggle `quarterTurn` **only when the resolved axis
  is diagonal**. A reflection leaves a perpendicular mirror where it is and
  exchanges the two diagonals.

Then have the four store actions apply it inside the same mutation that runs the
engine op, following the pair-pruning precedent already in `runBpTreeMutation`
([oristudioBpSlice.ts:495-509](apps/web/src/store/workspaceStore/slices/oristudioBpSlice.ts:495)) —
inside, so the whole thing is one undo entry and the orientation can never be
left disagreeing with the geometry.

Write it even when `symmetry.enabled` is false. The fold is a fact about the
design that outlives the toggle (mirror-draw off does not mean not symmetric),
so a design rotated with the toggle off and mirrored later must come back with
its mirror in the right place.

Finally, thread `BpMirrorOrientation` through the five entry points that
currently take a bare `fold` — `bpPackingSymmetryAxis`,
`constrainBpFlapGroupToAxisSides`, `buildMirroredBpFlapMoves`,
`constrainBpFlapMoveToAxis` and `resolveOptimizerSymmetry` — and their four real
callers: the flap-move and optimize paths in `oristudioBpSlice`,
`useBpPackingSymmetry`, `bpFlapSeeding` (which places a new flap's mirror twin
and would otherwise seed onto the wrong axis after a rotate), and
`BpOptimizerModal`.

### Phase 2 — Surface the four commands

Follow the path `bp.layout.subdivide` already takes end to end:

1. **Capability ids** — add `bp.layout.rotateRight`, `bp.layout.rotateLeft`,
   `bp.layout.flipHorizontal`, `bp.layout.flipVertical` to the
   `WorkspaceCapabilityId` union
   ([workspaceCapabilities.ts:71](apps/web/src/lib/workspaceCapabilities.ts:71)).
2. **Gate** — all four on the existing `canEditBpSheet` (`isBpContext &&
   hasBoxPleatDocument && !boxPleatBusy`), which is exactly upstream's
   `:disabled="!Studio.project"`. No extra predicate: a rotate swaps the sheet's
   width and height along with the design, so it can never push a flap off the
   sheet, and a flip is an isometry of the sheet. `bpSheetCapabilities.ts` gains
   nothing.
3. **Menu** — `menuDefinition.ts:188`, in the same block, in the screenshot's
   order: Subdivide Grid, Un-subdivide Grid, Rotate Right, Rotate Left,
   Horizontal Flip, Vertical Flip.
4. **Dispatch** — four ids into `MENU_ACTION_IDS`
   ([menuActions.ts:88](apps/web/src/commands/menuActions.ts:88)), four cases
   next to the subdivide cases, four methods on the `deps.workspace` interface.
5. **Command descriptors** — flip the four in `oristudioBpCommands.ts` from
   `placement: 'toolbar'` to `'menu'` to match where they actually land.

Optionally also put them in the packing pane's **"Sheet size & grid" popover**
([BpPackingPanel.tsx:459](apps/web/src/components/panels/BpPackingPanel.tsx:459))
as a four-icon "Transform" row, above the grid-type segment. That popover is
already the sheet's home, and four more top-level buttons would crowd a toolbar
that is meant to stay compact. If added, the buttons must dispatch through
`handleMenuAction(...)` rather than calling the store action directly, so the
analytics chokepoint covers them and no second hand-placed event is needed.

The native macOS menu needs no separate work — it is generated from
`menuDefinition`.

### Phase 3 — Strings

Four `menu:` labels, four `common:capability.*` labels and their reasons. Then
`npm run i18n:extract`, translate all 8 locales, `npm run i18n:stamp`,
`npm run i18n:check` (CI gates on it).

### Phase 4 — Tests

- `bpOptimizerSymmetry.test.ts` — the derivation table in full: 2 sheet kinds ×
  2 folds × 2 turns = 8 cases, asserting all four axes are reachable.
- New `mirrorAfterSheetTransform` table test — 4 transforms × 4 starting axes,
  including that subdivide is a no-op and that a flip is a no-op on the
  perpendicular axes.
- **The integration assertion that matters**: build a two-flap symmetric packing,
  apply each transform, and check that `buildMirroredBpFlapMoves` for one flap
  lands on where its partner actually is. This is the test that fails today for
  rotate, and it is the one that proves the fix.
- Store tests beside the existing `oristudioBpSymmetric*.test.ts` files: rotate
  toggles, flip toggles only for a diagonal fold, subdivide leaves it, `setFold`
  leaves it (the class/member independence, guarded so it stays true), and undo
  restores the previous orientation together with the geometry.
- `nativeProjectFile.test.ts` — round-trip, and a legacy file with no
  `quarterTurn` reading as `false`.
- `workspaceCapabilities.test.ts` — the four capabilities are visible only in a
  BP context and disabled while busy.
- `menuActions.test.ts` — each id reaches its store action.

## Affected Areas

- `apps/web/src/lib/bpTreeSymmetry.ts` — `BpMirrorOrientation`, the new field,
  default and validator.
- `apps/web/src/lib/bpOptimizerSymmetry.ts` — widened axis derivation.
- `apps/web/src/lib/bpPackingSymmetry.ts` — `mirrorAfterSheetTransform`, and the
  three entry points that take a bare `fold`.
- `apps/web/src/lib/nativeProjectFile.ts` — `.osf` symmetry block (`:606`, `:1281`).
- `apps/web/src/lib/workspaceCapabilities.ts` — four capability ids and gates.
- `apps/web/src/lib/oristudioBpCommands.ts` — descriptor placement.
- `apps/web/src/menus/menuDefinition.ts` — four Design-menu entries.
- `apps/web/src/commands/menuActions.ts` — ids, dispatch cases, deps.
- `apps/web/src/store/workspaceStore/slices/oristudioBpSlice.ts` — orientation
  update inside the four sheet-transform mutations.
- `apps/web/src/hooks/useBpPackingSymmetry.ts`, `apps/web/src/lib/bpFlapSeeding.ts`,
  `apps/web/src/components/BpOptimizerModal.tsx` — orientation threading.
- `apps/web/src/components/panels/BpPackingPanel.tsx` — optional transform row.
- `apps/web/public/locales/*` — 8 locales.
- **No Rust, no wasm rebuild.**

## Non-goals

- **Tree-sheet transforms.** Upstream's Edit menu acts on whichever sheet is
  active, so in tree mode it transforms the tree drawing. We should not follow it
  there: our BP tree editor uses *continuous* coordinates and deliberately does
  not snap to the tree grid
  ([bpTreeViewport.ts:129](apps/web/src/lib/bpTreeViewport.ts:129)), so
  subdividing the tree sheet refines nothing; and the tree mirror is defined as
  vertical (`BP_TREE_SYMMETRY_ANGLE = 90`) with `negativeSide` resolved by
  comparing x-coordinates, both of which a tree rotate would invalidate for no
  user-visible gain. There is also no kernel op for it. Worth revisiting only if
  BP tree vertices ever become grid-snapped.
- **Making a manual flip survive a re-optimize.** `negativeSide`
  ([bpOptimizerSymmetry.ts:235](apps/web/src/lib/bpOptimizerSymmetry.ts:235)) is
  read from the tree drawing — "which member of the pair did the user draw on the
  left" — so a horizontally-flipped packing will flip back on the next optimizer
  run. That is the general rule that Optimize re-packs from scratch and discards
  manual placement; encoding a side-swap bit to fight it is not worth the state.
  Document it; do not build it.

## Known interaction (not a bug)

An on-axis flap is projected to `center.x - width/2`
(`projectBpFlapAnchorOntoAxis`), which on an odd-centred sheet is an odd
coordinate — and `bpCanUnsubdivideSheet` requires every flap dot on an even line.
So a centred flap can disable Un-subdivide. This predates the change and the
capability already explains itself ("only when every flap sits on an even grid
line"); noted here so it is not mistaken later for fallout from the quarter turn.

## Validation

```bash
npx tsc --noEmit -p apps/web/tsconfig.json && npx vitest run --root apps/web && npm run lint:web && npm run i18n:check
```

Use `npx tsc --noEmit` rather than `npm run typecheck:web`: the npm script
regenerates the tracked wasm bindings nondeterministically, which would put an
unrelated diff in the PR.

Browser checklist (owner: Zach):

- [ ] Rotate right ×4 returns the packing to where it started.
- [ ] With mirror draw on and a book fold, rotate once — the mirror line lands
      across the sheet horizontally, and dragging a paired flap still moves its
      partner onto its actual mirror position.
- [ ] Same with a diagonal fold: rotate swaps which diagonal the line is drawn on.
- [ ] Horizontal flip with a book fold leaves the mirror line vertical; with a
      diagonal fold it swaps diagonals.
- [ ] Undo after each op restores both the geometry and the mirror line.
- [ ] Save to `.osf`, reopen, and confirm the mirror line comes back where it was.

## Checklist

- [ ] Phase 0: `BpMirrorOrientation` + `quarterTurn` on `BpDocumentSymmetry`;
      widened `optimizerSymmetryAxisForFold`; default, validator, `.osf` I/O.
- [ ] Phase 1: `mirrorAfterSheetTransform`; applied inside the four sheet-transform
      store mutations; orientation threaded through the packing entry points.
- [ ] Phase 2: four capability ids + gates, Design-menu entries, `MENU_ACTION_IDS`
      and dispatch, descriptor placement; optional packing-popover transform row.
- [ ] Phase 3: inline English strings, `i18n:extract`, 8 locales, `i18n:stamp`,
      `i18n:check` green.
- [ ] Phase 4: derivation table test, transform table test, the symmetric-packing
      integration test, store/undo tests, file round-trip, capability and dispatch
      tests.
- [ ] Validation commands run; browser checklist handed over.
