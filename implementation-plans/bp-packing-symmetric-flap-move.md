# Mirrored flap moves in the BP Editor

## Goal

In the **BP Editor** pane (the packing surface, `BpPackingPanel`), moving a flap
while mirror draw is on must move its symmetry partner to the mirrored position,
as one undoable step.

This closes the last hole in BP mirror draw. Every other paired edit already
carries its partner:

| Edit | Surface | Mirrors today |
| --- | --- | --- |
| Add leaf | Tree editor | yes (`addOristudioBpTreeLeafWithSymmetry`) |
| Drag node | Tree editor | yes (`moveOristudioBpTreeVerticesWithSymmetry`) |
| Delete node | Tree editor | yes (`bpTreeDeleteIdsWithSymmetry`) |
| Edit edge length | Tree editor | yes (`setOristudioBpTreeEdgeLength`) |
| **Resize flap** | **BP Editor** | **yes** (`resizeOristudioBpLayoutFlap`) |
| **Move flap (drag)** | **BP Editor** | **no** |
| **Move flap (arrow keys)** | **BP Editor** | **no** |

So the pane already mirrors a flap's *size* and not its *position*, which is the
worst of both: a user who resizes sees symmetry enforced, then drags and watches
it break.

## Why it does not work today

Not a bug in the pairing — the pairing machinery is sound and reusable:

- `mirrorBpTreeVertexId` resolves a partner from an explicit pair first, then by
  geometric inference, then `null`. Verified working against the store for both
  paths.
- A flap **is** its tree leaf: `oristudioBpSnapshotMapper.ts:452` sets
  `vertexId: flap.id`, so a flap id can be handed straight to
  `mirrorBpTreeVertexId`. `resizeOristudioBpLayoutFlap` already relies on this.

The gap is purely that the move actions never ask:

- [`oristudioBpSlice.ts:853`](../apps/web/src/store/workspaceStore/slices/oristudioBpSlice.ts:853)
  `moveOristudioBpLayoutFlap` — straight to the runtime, no symmetry branch.
- [`oristudioBpSlice.ts:909`](../apps/web/src/store/workspaceStore/slices/oristudioBpSlice.ts:909)
  `moveOristudioBpLayoutFlaps` — same.
- [`oristudioBpSlice.ts:864`](../apps/web/src/store/workspaceStore/slices/oristudioBpSlice.ts:864)
  `resizeOristudioBpLayoutFlap` — the one that *does* resolve the partner. It is
  the template.

And the pane has no symmetry surface at all: `BpPackingPanel.tsx` contains zero
references to symmetry, so there is no axis overlay and no way to see which flaps
are paired. Mirroring the move without drawing the mirror would leave the second
flap moving for no visible reason.

## The crux: the tree axis is not the paper axis

This is the part to get right, and the reason a mirrored move is not a two-line
change like the resize was.

**The tree's mirror line lives in tree coordinates.** `symmetry.loc` /
`symmetry.angle` are always "vertical, through the centre of the *tree* sheet"
(`BP_TREE_SYMMETRY_ANGLE`, `bpTreeSymmetryDefaultLoc`). Flap anchors live in the
**layout** sheet, which is a different sheet of a different size — the starter
project ships a 20×20 tree sheet and a 16×16 layout sheet. Reusing `symmetry.loc`
to reflect a flap anchor would silently reflect about the wrong line.

**How the mirror lands on the paper is the `fold`.** `symmetry.fold`
(`'book' | 'diagonal'`) is a fact about the design, and
`optimizerSymmetryAxisForFold(sheetKind, fold)`
([bpOptimizerSymmetry.ts:83](../apps/web/src/lib/bpOptimizerSymmetry.ts:83))
turns it into one of the kernel's four normalized axes. The resize path already
calls this — for the dimension swap — so the packing surface is already reading
symmetry in paper space. The move path needs the same axis, used for position.

**The kernel already owns the mirror map.** `SymmetryAxis::mirror_grid`
([optimizer.rs:1028](../crates/oristudio-bp/src/optimizer.rs:1028)) is canonical.
It is written in *centred* grid coordinates (see `centered()` at
[optimizer.rs:1003](../crates/oristudio-bp/src/optimizer.rs:1003) and the
`PORTING.md` note on why the symmetric fit measures from the sheet centre). In
the absolute sheet coordinates the packing pane uses, for a `w × h` sheet and a
flap of size `fw × fh` anchored at its lower-left corner:

| Axis | Mirrored anchor | Swaps `w`/`h` |
| --- | --- | --- |
| `verticalHalf` | `(w - x - fw, y)` | no |
| `horizontalHalf` | `(x, h - y - fh)` | no |
| `mainDiagonal` | `(y, x)` | yes |
| `antiDiagonal` | `(h - y - fh, w - x - fw)` | yes |

**The size term is the trap.** A flap's anchor is a corner, not a centre, so
mirroring a flap is not mirroring its anchor — the reflected box picks up `fw` /
`fh`. Getting this wrong produces a partner that is off by exactly the flap's
width, which looks plausible for a small flap and obviously wrong for a large
one. The kernel's own doc comment on `mirror_norm` says this; the port must
repeat the derivation, not eyeball it.

## Approach

Two parts, and **the UI half goes first**. Without a drawn mirror line the
mirrored move has nothing to explain itself with: a second flap jumps and the
user has no way to know why, or to tell whether it went to the right place.

---

## Part 1 — Make the mirror settable and visible in the BP Editor

Today the fold can only be chosen from inside the optimize dialog, and the pane
that the fold actually describes cannot show it or change it. The dialog even
says so out loud:

> "Symmetry is off. Turn it on in the tree view to mirror the layout."
> — [BpOptimizerModal.tsx:277](../apps/web/src/components/BpOptimizerModal.tsx:277)

A dialog whose job includes pointing at another pane is the tell that the control
is in the wrong place.

### U1 — The fold is one value with two editors, and that is already true

`fold` is persisted design state on the box-pleat document
(`BpDocumentSymmetry.fold`, `.osf` schema v6), written through
`setOristudioBpSymmetry`. Adding a second editor for it is **zero plumbing**:
both surfaces read `oristudioBpSymmetry` and call the same setter, so changing it
in either place updates the other live. No new state, no syncing, no derived copy.

Keep it editable in the modal as well as the pane. The one cost is that the
modal's Symmetry row then mixes a *design* edit (`fold`) with a *run* option
(`options.respectSymmetry`) in one visual group — separate them with a divider or
a label so the fold does not read as "this run only". See U6.

### U2 — A symmetry popover beside the sheet popover

Put it in the packing pane's viewport toolbar, immediately next to the existing
Ruler "Sheet size & grid" popover, triggered by a `FlipHorizontal2` icon that
shows active state so on/off reads at a glance. Contents:

- **Mirror draw** toggle — the same `enabled` the tree pane already writes.
- **Fold** — a Book / Diagonal segmented control, the same shape as the
  Rect / Diagonal control it sits beside.
- A quiet status line from `resolveOptimizerSymmetry` ("3 flaps have no partner").

The adjacency is not cosmetic. `optimizerSymmetryAxisForFold(sheet.kind, fold)`
takes the grid type — a book fold is the vertical axis on a rectangular sheet and
the *diagonal* one on a diamond sheet — so the two controls determine each
other's meaning and belong a thumb's width apart.

The tree pane keeps its plain toggle rather than gaining the same popover: a tree
has no fold to choose, because it is not drawn on the paper. That asymmetry is
the existing design decision, not an oversight.

### U3 — Draw the axis whenever mirror draw is on, and label it

**Gate the line on `enabled`, not on pairings existing.** The line is what you
place the first pair *against*, so a rule that waits for pairs can never let you
make one. `enabled` already defaults to true for a new design.

`pairs.length > 0` is the wrong predicate anyway: `pairs` holds only *explicit*
pairings recorded by mirror-draw adds, so a loaded `.bps` can be perfectly
symmetric with zero entries — geometric inference does the work there. The
predicate that actually answers "is this design symmetric" is
`resolveOptimizerSymmetry`, which the modal already uses for its
off / ready / unusable states. Reuse it for the status line in U2, not for
hiding the axis.

**Label the line.** The two panes draw genuinely different lines: the tree's is
always vertical through the tree sheet's centre, the packing pane's is vertical
*or* 45° through the layout sheet's centre depending on fold × grid type. So
switching Book → Diagonal visibly rotates the BP Editor's line while the tree's
does not move at all. Correct, and it will read as a bug unless the axis carries
its fold name or the popover carries a one-line hint.

### U4 — Disable the fold option, do not reject the drag

A diagonal axis maps a rectangular sheet onto itself only when it is square, and
a non-square layout sheet is reachable: a rectangular sheet has independent Width
and Height inputs
([BpPackingPanel.tsx:432](../apps/web/src/components/panels/BpPackingPanel.tsx:432)),
while a diagonal sheet is forced square by its single Size input.

Disable the Diagonal option with a reason when the layout sheet is not square.
Failing at choose-time, where the user can act on it, beats failing at drag-time
where it is a mystery. This supersedes the drag-time rejection in D7.

### U5 — Show the pairing

- Give the packing pane the tree pane's **Unpair from mirror** button. Same
  `pairs` state, same `unpairOristudioBpTreeSymmetry` action — someone working
  only in the BP Editor should not be sent back to the tree to break a pair.
- **Mark the partner when a flap is selected.** This is what makes "moving one
  moves the other" legible *before* the drag instead of a surprise during it.

### U6 — Clean up the modal

- Drop the "Turn it on in the tree view" hint: the BP Editor now has the toggle,
  and so does the tree.
- Separate the design edit (fold) from the run option (`respectSymmetry`) within
  the Symmetry row, so the fold does not read as a per-run choice.

### Not in scope: a custom axis

Do not add an angle or position control. `angle` and `loc` are derived from the
sheet on every load *on purpose* ([bpTreeSymmetry.ts:75](../apps/web/src/lib/bpTreeSymmetry.ts:75)),
so a file can never carry a mirror line that disagrees with the sheet it
describes. The `fold` enum is the entire vocabulary.

---

## Part 2 — Mirror the move

Follow the shape the tree side already established — pure adapter module, store
action, panel branches — rather than putting arithmetic in the pane.

### D1 — Mirror the target, not the delta

Partner anchor := `mirror(primary's new anchor)`, absolute.

`buildMirroredBpTreeUpdates`
([bpTreeSymmetry.ts:217](../apps/web/src/lib/bpTreeSymmetry.ts:217)) already
reflects the target location rather than applying a mirrored delta, so a partner
that has drifted out of symmetry snaps back on the first drag. Matching that
keeps one mental model across the two panes: under mirror draw, moving a flap
*states* where its partner goes.

### D2 — Two engine calls, not one batch

`move_flaps(ids, target)`
([project_session.rs:400](../crates/oristudio-bp/src/engine/project_session.rs:400))
translates the whole group by a **single** vector derived from the reference flap,
and clamps that one vector against every flap in the group. A reflection is not a
translation — a pair moves in opposite directions along the axis normal — so a
pair cannot ride one call. Issue the primary move and the partner move as two
runtime calls inside one `runBpTreeMutation`, exactly as the mirrored resize does.
One undo entry, one status message.

No kernel change is needed for this, and none should be added: everything the port
needs is already exported.

### D3 — An on-axis flap slides along the axis; it does not freeze

The tree pane refuses to drag an on-axis vertex
([BpTreePanel.tsx:751](../apps/web/src/components/panels/BpTreePanel.tsx:751)),
because a tree vertex on the mirror line has nothing left to be if it moves off.
**Do not copy that here.** An on-axis flap still has a free parameter along the
axis — that is precisely what `SymmetryAxis::axis_parameter`
([optimizer.rs:1068](../crates/oristudio-bp/src/optimizer.rs:1068)) and
`axis_point` ([optimizer.rs:1058](../crates/oristudio-bp/src/optimizer.rs:1058))
exist for — and freezing a centre flap in the packing pane would make symmetric
designs unusable.

Constrain such a flap's target onto the axis (project the target, then snap with
`axis_point`) instead of refusing it. This is a deliberate divergence from the
tree pane and should be written down as one.

### D4 — Partial mirror

A flap with no resolvable partner moves alone, no error. Same rule as the tree
(`buildMirroredBpTreeUpdates` skips an unresolved id) and same reason: a
partially-symmetric design must stay editable.

### D5 — Multi-flap drags mirror per flap, skipping the set

For a group drag, compute the group's constrained target per flap, then mirror
each flap whose partner is **not itself in the dragged set**. A selection holding
both members of a pair translates rigidly and mirrors nothing — the same skip
`buildMirroredBpTreeUpdates` makes via `primaryIds.has(mirrorId)`.

### D6 — Clamp before mirroring, then verify the mirror clamps identically

`constrainBpPackingFlapGroupTarget` already clamps the primary target to the
sheet. Mirror the **clamped** target, then clamp the mirrored one too. If the
second clamp bites, refuse the whole move rather than land a lopsided pair.

The axis passes through the sheet centre and the constraint region is symmetric
about it, so this should be unreachable — which is a reason to assert it in a
test, not a reason to assume it. This is the failure the tree plan's risk section
flagged and never got a test for.

### D7 — Diagonal fold on a non-square sheet: guard, don't refuse

U4 disables the Diagonal option when the layout sheet is not square, so the
unmirrorable combination should be unreachable from the UI. It is still reachable
from a file — an `.osf` saved at a square sheet and reopened after a resize — so
`buildMirroredBpFlapMoves` must return "no mirror" for it rather than compute an
off-sheet target. A guard on an unreachable state, not a user-facing rejection.

### D8 — Moves move; they do not resize

Under a diagonal axis the partner's `width`/`height` are exchanged. A mirrored
*move* must **not** also fix the partner's dimensions: that is the resize path's
job, it already does it, and the optimizer rejects a mismatched pair outright
(`validate_dimensions`). A move that silently resized would make two edits out of
one gesture and would fight the resize path on undo.

## Affected Areas

**New — pure, unit-tested, no React:**

- `apps/web/src/lib/bpPackingSymmetry.ts` — the packing analogue of
  `bpTreeSymmetry.ts`. Holds: the layout-space axis for a `(sheet, fold)`, the
  four mirror maps transcribed from `SymmetryAxis::mirror_grid` with a comment
  pointing at it, the on-axis test and axis projection (D3), the
  non-square-diagonal rejection (D7), and a `buildMirroredBpFlapMoves(...)`
  that turns a primary set of flap targets into the partner set (D1/D4/D5).
- `apps/web/src/hooks/useBpPackingSymmetry.ts` — view model for the pane: is it
  on, where the axis line falls in SVG coords, which flaps are paired. Copy the
  shape of `useBpTreeSymmetry.ts` (small interface in, view model out).
- `apps/web/src/lib/bpPackingSymmetry.test.ts`,
  `apps/web/src/store/workspaceStore/slices/oristudioBpSymmetricFlapMove.test.ts`.

**Edited:**

- `apps/web/src/store/workspaceStore/slices/oristudioBpSlice.ts` — add
  `moveOristudioBpLayoutFlapWithSymmetry` and `...FlapsWithSymmetry`, each one
  `runBpTreeMutation`, labelled `'Moved mirrored BP flap(s)'` so undo reads
  correctly. Both delegate to the existing action when symmetry is off, the way
  `moveOristudioBpTreeVerticesWithSymmetry` does.
- `apps/web/src/store/workspaceStore/types.ts` — the two action signatures.
- `apps/web/src/components/panels/BpPackingPanel.tsx` — the symmetry popover
  beside the sheet popover (U2), the axis overlay and unpair button (U3, U5), and
  the routing of `useBpPackingDragRequests` and `nudgeSelection`
  ([:925](../apps/web/src/components/panels/BpPackingPanel.tsx:925)) through the
  symmetric actions. **Branches and mounts, not logic** — the panel is a
  composition site and is under `max-lines`. The popover's contents belong in
  their own component next to `BpSheetSizeInput`, its store bindings in the new
  hook; if the count fires, that is the seam, not a `BpPackingPanelParts.tsx`.
- `apps/web/src/components/BpOptimizerModal.tsx` — drop the "turn it on in the
  tree view" hint, separate the fold from `respectSymmetry` (U6). The fold
  `Select` itself stays and needs no change: it already writes shared document
  state.
- `apps/web/src/components/panels/BpPackingPanel.test.tsx` — the popover, the
  axis gating, and the routing branch.

**Not touched:** no Rust, no wasm bridge, no `.osf` schema. The axis maths,
the dimension-swap rule, and the pair resolution all already exist and are
exported.

## Risks

- **The anchor size term (see above).** Highest-probability defect. Mitigation:
  transcribe the table from `mirror_grid` and test all four axes with a
  deliberately non-square flap, where an anchor-only reflection is visibly wrong.
- **Reaching for `symmetry.loc` in layout code.** It is the *tree* sheet's centre
  and the two sheets differ in size in the starter project. A test on a project
  whose tree and layout sheets differ catches this; two equal-sized sheets would
  not.
- **The nudge path being forgotten.** Arrow keys go through `nudgeSelection`, a
  separate call site from the drag. It has the same gap and needs the same
  routing. (Separately, that handler is a container-scoped `keydown` listener,
  which `AGENTS.md` says should live in `keyboard/` — pre-existing, out of scope
  here, worth a follow-up.)
- **Mid-drag cost.** The packing drag already round-trips the engine once per
  frame (`useBpPackingDragRequests`); mirroring doubles the calls per frame.
  Watch for jank on a large packing before assuming it is free — the request
  chaining will serialize them.
- **Verification.** The automated Browser pane runs with zero `rAF`, and both the
  drag throttle and the tree preview depend on it, so a pointer drag cannot be
  driven there. Store-level behaviour is fully testable; the gesture itself needs
  a human.

## Checklist

### Part 1 — surface the mirror

- [ ] `hooks/useBpPackingSymmetry.ts`: enabled/fold, the axis line in SVG coords,
      paired-flap ids, and the `resolveOptimizerSymmetry` status — store bindings
      live here, not in the panel.
- [ ] Symmetry popover in the packing toolbar beside the Ruler popover: mirror
      draw toggle, Book / Diagonal segmented control, status line (U2).
- [ ] Fold writes through the existing `setOristudioBpSymmetry` — assert in a test
      that the modal and the pane read back the same value with no extra state
      (U1).
- [ ] Axis overlay drawn whenever `enabled`, independent of `pairs` (U3), carrying
      its fold name so a Book → Diagonal switch does not look like a bug.
- [ ] Diagonal disabled with a reason when the layout sheet is not square (U4).
- [ ] Unpair button and partner highlight in the packing pane (U5).
- [ ] Modal: drop the "turn it on in the tree view" hint, separate the fold from
      `respectSymmetry` (U6).
- [ ] No angle/position control anywhere — `angle` and `loc` stay derived.

### Part 2 — mirror the move

- [ ] `lib/bpPackingSymmetry.ts`: layout-space axis from `(sheet, fold)`, the four
      mirror maps transcribed from `SymmetryAxis::mirror_grid`, on-axis
      test/projection, non-square-diagonal rejection.
- [ ] `lib/bpPackingSymmetry.test.ts`: all four axes with a non-square flap;
      anchor size term; round-trip (`mirror(mirror(p)) === p`); on-axis parameter;
      partial mirror; skip-when-partner-is-in-the-set; the D7 guard.
- [ ] `buildMirroredBpFlapMoves(...)` — primary targets in, partner targets out
      (D1, D4, D5).
- [ ] Store: `moveOristudioBpLayoutFlapWithSymmetry` /
      `moveOristudioBpLayoutFlapsWithSymmetry`, one `runBpTreeMutation` each,
      distinct undo labels, delegating when symmetry is off (D2).
- [ ] Store: clamp the mirrored target and refuse an asymmetric clamp (D6),
      with the test that asserts it never fires on a centred axis.
- [ ] `oristudioBpSymmetricFlapMove.test.ts`, on the
      `oristudioBpSymmetricDelete.test.ts` harness: two runtime calls with the
      right targets, one history entry, no-op with symmetry off, partial mirror,
      explicit pair beats geometric inference, tree sheet ≠ layout sheet.
- [ ] Panel: route the drag (`useBpPackingDragRequests`) through the symmetric
      actions.
- [ ] Panel: route the arrow-key nudge through them too.
- [ ] Hook + overlay: mirror axis line in the packing pane, and a visible mark on
      paired flaps, so the second flap does not move unexplained.
- [ ] i18n for any new string (`t()` inline default → `npm run i18n:extract` →
      8 locales → `npm run i18n:stamp` → `npm run i18n:check`).
- [ ] Decide whether mirror draw needs an adoption event, or whether the toggle is
      the right place for it — a per-sample drag event would violate the taxonomy
      in `docs/analytics.md`.
- [ ] Validation: `npx tsc --noEmit` + `vitest` in `apps/web`, `npm run lint:web`.
      No Rust surface is touched, so no `cargo` run is required — say so in the PR.
- [ ] Browser check (Zach), Part 1: the axis draws on a design with no explicit
      pairs; switching Book ↔ Diagonal rotates the packing line and leaves the
      tree's alone, and reads as intended rather than as a glitch; the same switch
      made in the modal updates the pane and vice versa; Diagonal is disabled on a
      non-square sheet; selecting a flap marks its partner.
- [ ] Browser check (Zach), Part 2: drag a paired flap → partner mirrors live;
      drag the pair's other member → same; arrow-key nudge mirrors; an on-axis
      flap slides along the axis and does not jump off it; a group holding both
      members translates rigidly; undo is one step; mirror draw off behaves
      exactly as before; a `book` and a `diagonal` fold both land correctly.
