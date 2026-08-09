# Flap axis pinning follows the mirror-draw toggle

## Goal

In the **BP Editor** (the packing surface), a flap must be draggable anywhere on
the sheet when mirror draw is off.

Today it is not. A brand-new Box Pleat design cannot have either of its two
starter flaps moved sideways at all — they slide up and down the sheet's vertical
centre line and refuse to leave it — even though mirror draw is off and the user
has made no symmetry claim about the design. Left/right arrow-key nudge is a
silent no-op for the same reason.

After this change:

| Mirror draw | A flap whose leaf sits on the tree's mirror line |
| --- | --- |
| **off** | moves anywhere, like any other flap |
| **on** | stays centred on the paper's mirror, as today |

Nothing else about BP symmetry changes. In particular, a flap with a *partner*
still carries that partner and still stays in its own half of the paper with the
toggle off — see [Scope](#scope-what-this-does-not-change).

## Why it happens

Three facts meet.

**1. The starter design is degenerate.** `BP_STARTER_PROJECT`
([oristudioBpSlice.ts:91](../apps/web/src/store/workspaceStore/slices/oristudioBpSlice.ts:91))
scaffolds a root with two unit leaves, all three nodes at `x = 10` on a 20×20
tree sheet. The tree's mirror line is always vertical through the tree sheet's
centre (`BP_TREE_SYMMETRY_ANGLE`, `bpTreeSymmetryDefaultLoc`), which is `x = 10`.
So *every node in a new design sits exactly on the mirror line* — not because
anyone drew it there, but because a three-node path has nowhere else to be.

**2. "On the line" is inferred as "is its own mirror."**
`mirrorBpTreeVertexId` resolves an explicit pair first, and otherwise guesses
from geometry — and its first geometric branch is
[bpTreeSymmetry.ts:207](../apps/web/src/lib/bpTreeSymmetry.ts:207):

```ts
if (symmetrySide(loc, axis, tolerance) === 0) return vertexId; // on the axis → self-mirror
```

`bpIsSelfMirrored`
([oristudioBpSlice.ts:278](../apps/web/src/store/workspaceStore/slices/oristudioBpSlice.ts:278))
is exactly this test, so both starter leaves report as self-mirrored.

**3. A self-mirrored flap is projected onto the paper's mirror on every move.**
[oristudioBpSlice.ts:1138](../apps/web/src/store/workspaceStore/slices/oristudioBpSlice.ts:1138):

```ts
const onAxis =
  reference && bpIsSelfMirrored(reference.id, designId)
    ? constrainBpFlapMoveToAxis(reference, loc, before.sheet, symmetry.fold) ?? loc
    : loc;
```

Under a book fold on a rectangular sheet that is `projectBpFlapAnchorOntoAxis`'s
`verticalHalf` case: `x` is forced to `center.x - width/2` and `y` passes
through. The 16×16 layout sheet centres at `x = 8`, which is where the starter
file already parks both flaps — so the pin is invisible until you try to drag,
and then it looks like the flap is stuck to a rail.

`moveOristudioBpLayoutFlapWithSymmetry` is the *only* way the pane moves a flap:
pointer drag, arrow keys, and the nudge buttons in the pane's toolbar all route
through it ([BpPackingPanel.tsx:635](../apps/web/src/components/panels/BpPackingPanel.tsx:635)).
So all three are affected, and a horizontal nudge on a starter flap does nothing
at all.

Note what is **not** involved: the group half-clamp
(`constrainBpFlapGroupToAxisSides`) only acts on flaps in `pairedIds`, and
`bpMirrorPartnerId` returns `null` for a self-mirrored vertex. The projection at
line 1138 is the whole of it.

## The crux: self-mirroring is always a guess

The BP slice deliberately does **not** read `symmetry.enabled` when resolving
pairs, and that decision is right and should stand
([oristudioBpSlice.ts:250](../apps/web/src/store/workspaceStore/slices/oristudioBpSlice.ts:250)):

> **Pairing does not depend on mirror draw.** That toggle decides one thing:
> whether a *new* node is drawn with a twin. A pair, once it exists, is part of
> the design […] Reading the flag here is what made the whole feature vanish when
> the user stopped drawing symmetrically.

Self-mirroring is a different kind of claim, and the difference is what makes
this fix narrow rather than a partial revert of that decision:

**A vertex can never be its own explicit pair.** Every path that builds a pair
rejects `v1 === v2` — `addBpTreeSymmetryPair`
([bpTreeSymmetry.ts:65](../apps/web/src/lib/bpTreeSymmetry.ts:65)),
`validateBpDocumentSymmetry` on load, and `filterBpTreeSymmetryPairs` on install.
So `explicitBpTreePairId` can never return the vertex it was asked about, and
`mirrorBpTreeVertexId(…) === vertexId` is reachable **only** through the
geometric on-axis branch.

Which means: *"this flap is its own mirror" is always an inference from where the
node happens to sit, never a fact the user recorded.* An explicit pair survives
the toggle because the user made it; a geometric self-mirror should not, because
nobody did. Gating it touches no explicit pairing whatsoever.

**The tree pane already works this way.** `isOnAxis` — which drives the tree
editor's on-axis drag pin via `pinToAxis`
([TreeEditor.tsx:597](../apps/web/src/tree-editor/TreeEditor.tsx:597)) — opens
with exactly the gate this plan adds
([useBpTreeSymmetry.ts:166](../apps/web/src/hooks/useBpTreeSymmetry.ts:166)):

```ts
if (!symmetry.enabled) return false;
```

So with mirror draw off you can already drag the starter *node* off the line
freely, and doing so is in fact the current workaround for the bug: move the leaf
in the tree, and its flap stops being self-mirrored and comes unstuck. The two
panes disagree about the same rule, and the packing pane is the one that is
wrong.

## Approach

One gate, in the predicate, matching `isOnAxis` line for line.

In `bpIsSelfMirrored`
([oristudioBpSlice.ts:278](../apps/web/src/store/workspaceStore/slices/oristudioBpSlice.ts:278)),
return `false` when `symmetry.enabled` is false, before asking the geometry.

Put it in the predicate rather than at the call site: it is one question with one
answer, the answer is the same for every future caller, and the existing doc
comment is where the rule belongs — extend it to say that a self-mirror is a
guess and the toggle is what licenses the guess, and cross-reference `isOnAxis`
as the tree pane's copy of the same rule.

Two consequences to accept deliberately, both of which get a test:

- **Turning mirror draw back on re-pins the flap on the next drag.** A user who
  drags a starter flap to the corner with symmetry off, then enables mirror draw
  and nudges it, will see it snap back to the centre line. That is correct: the
  leaf is still on the tree's mirror, so under mirror draw its flap must be
  centred for the packing to be symmetric at all. It is the same snap the tree
  pane's `pinToAxis` already applies to the node.
- **Nothing re-centres the flap when the toggle flips.** Enabling mirror draw
  does not move anything by itself; the design becomes symmetric again on the
  next edit to that flap. Consistent with the toggle everywhere else — it decides
  how the *next* edit behaves, it never rewrites the drawing.

### Scope: what this does not change

Confirmed with the user; listing it so a reviewer does not read the omission as
an oversight. With mirror draw **off**, all of these keep behaving exactly as
they do today:

- A flap with a geometrically-inferred partner still carries that partner
  (`buildMirroredBpFlapMoves`), locked in by *"still carries the partner after
  mirror draw is switched off"* in `oristudioBpSymmetricFlapMove.test.ts`.
- A paired flap still cannot cross into its partner's half
  (`constrainBpFlapGroupToAxisSides`).
- Delete, edge-length edit, and flap resize still mirror.
- Flap seeding is already correctly gated: the non-symmetry add path passes
  `fold: null` and leaves `selfMirrored` at its `false` default
  ([oristudioBpSlice.ts:751](../apps/web/src/store/workspaceStore/slices/oristudioBpSlice.ts:751)),
  and `addOristudioBpTreeLeafWithSymmetry` returns to that path when the toggle
  is off. No change needed.

Also out of scope, and worth naming as a follow-up rather than smuggling in: the
packing pane gives **no visual indication that a flap is pinned** when mirror
draw is on. The axis line is drawn, but a user dragging a self-mirrored flap gets
no cue that the sideways component is being discarded on purpose. That is a real
gap; it is a design question, not this bug.

## Affected Areas

| File | Change |
| --- | --- |
| [`apps/web/src/store/workspaceStore/slices/oristudioBpSlice.ts`](../apps/web/src/store/workspaceStore/slices/oristudioBpSlice.ts) | `bpIsSelfMirrored` gains the `enabled` gate; doc comment extended |
| [`apps/web/src/store/workspaceStore/slices/oristudioBpSymmetricFlapMove.test.ts`](../apps/web/src/store/workspaceStore/slices/oristudioBpSymmetricFlapMove.test.ts) | New cases for the toggle-off path |

Deliberately untouched: `lib/bpPackingSymmetry.ts` (the geometry is right — it is
only being asked the wrong question), `lib/bpTreeSymmetry.ts` (the inference is
right for callers that want a guess), `BpPackingPanel.tsx` (no UI change),
`lib/bpFlapSeeding.ts` (already gated).

**No new user-facing strings**, so no `i18n:extract` / `i18n:check` cycle.
**No new analytics event**: this is a constraint bug fix, not a new feature,
tool, or flow, and the mirror-draw toggle itself is already captured where it is
dispatched. Adding an event for "a flap moved" would be per-drag noise.

## Checklist

- [x] Gate `bpIsSelfMirrored` on `symmetry.enabled`, and extend its doc comment
      to say why a self-mirror is a guess the toggle licenses — citing that an
      explicit pair can never be self-referential, and pointing at `isOnAxis` as
      the tree pane's copy of the rule
- [x] Test: with `enabled: false`, a flap whose leaf is on the tree's mirror line
      moves to the requested position (the starter-design case, and the direct
      regression test for this report)
- [x] Test: with `enabled: true`, the existing "slides a flap that is its own
      mirror along the axis instead of off it" still passes unchanged
- [x] Test: with `enabled: false`, a flap that has a *partner* still carries it —
      the existing case, left in place next to the new one so the two rules are
      visibly different rather than looking like a contradiction
- [x] Test: flipping `enabled` back on re-pins a flap that was dragged off the
      line while it was off
- [x] Both new tests verified to fail with the gate removed — the failure is the
      report verbatim (drag asks `x = 2`, engine is sent `x = 7`) — and exactly
      those two fail, so the change is no wider than it claims
- [x] `npx tsc --noEmit` in `apps/web` and `npx vitest run` (the
      `npm run typecheck:web` / `test:web` wrappers regenerate the tracked wasm
      bindings nondeterministically — avoid them for a web-only change). Full
      suite: 2969 passed, 287 files
- [x] `npm run lint:web`
- [x] Verified in the running app against the real wasm engine, by driving
      `moveOristudioBpLayoutFlapWithSymmetry` on the live store from a fresh Box
      Pleat design. The starting state confirmed the diagnosis exactly — symmetry
      off, all three tree vertices at `x = 10` on the mirror line, both flaps at
      `x = 8`:

      | Step | Asked | Landed | |
      | --- | --- | --- | --- |
      | Mirror draw **off** | `(3, 4)` | `(3, 4)` | free |
      | Enable mirror draw | — | `(3, 4)` | nothing re-centres by itself |
      | Mirror draw **on** | `(2, 6)` | `(8, 6)` | pinned to the axis, `y` passes through |
      | Mirror draw **off** again | `(12, 2)` | `(12, 2)` | free again |

- [ ] Browser check, on the dev server — the **pointer gesture itself** is all
      that is left. It cannot be driven from the automated pane: that pane runs
      `visibilityState: hidden` with zero rAF callbacks, and the drag commits
      inside a `requestAnimationFrame`
      ([useBpPackingDragRequests.ts:133](../apps/web/src/hooks/useBpPackingDragRequests.ts:133)),
      so a synthetic drag there is swallowed and its failure means nothing. The
      gesture's only effect is to call the action verified above.
  - [ ] New Box Pleat design, mirror draw off: drag either starter flap
        left/right — it follows the pointer anywhere on the sheet
  - [ ] Same design: left/right arrow nudge and the pane's nudge buttons move the
        flap
  - [ ] Turn mirror draw on, drag a flap sideways — it snaps back to the centre
        line and slides only along it
  - [ ] Draw a symmetric pair of leaves with mirror draw on, turn it off, drag
        one of the pair's flaps — the partner still mirrors (the deliberately
        unchanged behaviour)
