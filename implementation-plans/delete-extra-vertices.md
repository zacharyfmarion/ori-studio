# Delete Extra Vertices

## Goal

Expose Oriedita's two whole-document "delete extra vertices" repairs in Ori
Studio. Both collapse degree-2 vertices where the two incident creases are
collinear, merging them into one crease:

- **`v_del_allAction`** — "Delete Extra Vertices", merges only when both creases
  are the *same* colour. Upstream hotkey `Ctrl+Shift+V`.
- **`v_del_all_ccAction`** — "Delete Extra Vertices (ignore colour)", the tool in
  the screenshot. Merges regardless of colour and resolves the merged colour from
  a fixed matrix. No upstream hotkey.

The screenshot only shows the ignore-colour variant, but the two are a pair in
upstream's toolbar and share every line of implementation and wiring. Porting
one and not the other costs more in explanation than it saves in work.

**The kernel algorithm is already ported and already oracle-tested.** What is
missing is the entire product surface: there is no `OperationId`, so
`execute_command` cannot reach it, so nothing downstream — wasm, command
catalog, menu, capability, shortcut, i18n — exists. This plan is therefore
mostly wiring, plus two real defects the wiring would otherwise ship
(Phases 5 and 6).

## Upstream reference

All paths under `third_party/oriedita/`.

| Behaviour | Upstream |
| --- | --- |
| Action registration | `oriedita/.../service/ActionRegistrationService.java:233-235` |
| Same-colour entry point | `CreasePattern_Worker_Impl.v_del_all` — `oriedita/.../canvas/impl/CreasePattern_Worker_Impl.java:804` |
| Ignore-colour entry point | `CreasePattern_Worker_Impl.v_del_all_cc` — same file, `:817` |
| Same-colour sweep | `FoldLineSet.del_V_all` — `origami/.../crease_pattern/FoldLineSet.java:1483` |
| Ignore-colour sweep | `FoldLineSet.del_V_all_cc` — same file, `:1502` |
| Pairwise merge + colour matrix | `FoldLineSet.del_V(LineSegment, LineSegment)` — same file, `:1388` |
| Vertex→lines index | `PointLineMap` — `origami/.../crease_pattern/PointLineMap.java` |
| Collinearity classification | `OritaCalc.determineLineSegmentIntersection` — `origami/.../crease_pattern/OritaCalc.java:359-406` |
| Toolbar placement | `oriedita-ui/.../swing/tab/DrawingTab.java:104` |
| Labels | `oriedita-ui/src/main/resources/name.properties:53-54` |
| Hotkey | `oriedita/src/main/resources/hotkey.properties:55-56` |

Four upstream facts shape the design:

- **A merge requires collinearity, not just degree 2.** `del_V` acts only on
  intersection codes `323`/`333`/`343`/`353`, which
  `determineLineSegmentIntersection` returns for parallel, equal-line segments
  that share exactly one endpoint and do not otherwise overlap
  (`OritaCalc.java:359-406`). A genuine V-shaped corner is left alone; the tool
  removes *redundant* vertices only. `del_V` passes `Epsilon.UNKNOWN_1EN5` as
  both the equality and parallelism tolerance.
- **The colour matrix is the visible behaviour of the ignore-colour variant**
  (`FoldLineSet.java:1406-1472`). Notably **mountain + valley → edge**
  (`RED_1` + `BLUE_2` → `BLACK_0`), and black + red/blue takes the coloured one.
  Any pairing with `CYAN_3` returns `null` (no merge).
- **`PointLineMap` skips cyan entirely** (`PointLineMap.java:36`). So an
  auxiliary line ending at a vertex does not raise that vertex's degree: two
  collinear black creases meeting where an aux line also terminates *will* merge,
  leaving the aux endpoint dangling mid-crease. Preserve this; it also makes
  every `CYAN_3` branch of the colour matrix dead code on this path.
- **Undo is recorded only if the segment count actually changed**
  (`CreasePattern_Worker_Impl.java:806-810`).

## Approach

### What already exists — verified, no work needed

| Piece | Location | State |
| --- | --- | --- |
| `del_V_all` | `operations/arrangement.rs:748` (`del_v_all`) | Faithful |
| `del_V_all_cc` | `operations/arrangement.rs:753` (`del_v_all_color_change`) | Faithful |
| `del_V(si, sj)` | `operations/arrangement.rs:758` (`del_v_pair`) | Faithful |
| Colour matrix | `operations/arrangement.rs:1032` (`del_v_pair_color`) | Matches `:1406-1472` line for line |
| `PointLineMap` | `operations/arrangement.rs:963` (`point_line_groups`) | Faithful, but see Phase 5 |
| Collinearity codes | `geometry/orita_calc.rs:171` | Ported |
| Java oracle commands | `foldline-del-v-all`, `foldline-del-v-all-cc` | Already driven by `tests/oriedita_operations_oracle.rs:447-468` |
| Unit tests | `tests/operations.rs:521`, `:542` | Cover both variants |
| Icon glyphs | `CpToolRail.tsx:265-266` (``, ``) | Present |
| Upstream hotkey record | `keyboard/shortcuts.ts:158` | Present, unbound |

### Phase 1 — Make the kernel ops dispatchable

`crates/oristudio-cp/src/lib.rs`:

- Add `OperationId::DeleteExtraVertices` and
  `OperationId::DeleteExtraVerticesIgnoreColor` beside `Fix1`/`Fix2` (`:441`).
- Add two `descriptor!` rows next to Fix1's (`:1403`), pointing at
  `"v_del_allAction"` / `"v_del_all_ccAction"` upstream and
  `"operations::arrangement::del_v_all"` /
  `"operations::arrangement::del_v_all_color_change"`, category `Kernel`,
  stage `9` (the whole-document repair family), status `OracleTested`.
- Add dispatch arms beside `Fix1`'s (`:2490`). Neither op takes a payload.
  Return the segment-count delta as the change count, mirroring the
  `DeletePoint` arm (`:1548-1557`):

  ```rust
  let before = document.crease_pattern.line_segments.len();
  operations::arrangement::del_v_all(&mut document.crease_pattern);
  before.abs_diff(document.crease_pattern.line_segments.len())
  ```

  That makes the diagnostic read `Changed N line(s)` with N = vertices removed,
  and a no-op honestly report 0.

No wasm-bridge change: `execute_cp_command` deserializes `OperationId`
generically (`crates/oristudio-cp-wasm/src/lib.rs:125-134`). The `.wasm` does
need rebuilding and committing — the bridges under `apps/web/src/generated/**`
are tracked, so a kernel-only change does not reach the app or CI until it is.

### Phase 2 — Command catalog, capabilities, Repair submenu

**Both** actions land in the Crease Pattern → Repair submenu. The ignore-colour
variant *additionally* gets a left-rail button (Phase 3); the rail is an extra
affordance on top of the menu entry, not instead of it.

- `apps/web/src/lib/oristudioCpCommands.ts` — add two `ready(...)` entries after
  `Fix2` (`:764`), group `check-fix`, icon `wrench`. Placement differs:
  `'left-rail'` for the ignore-colour variant, `'menu'` for the same-colour one.
  Add both ids to `ORISTUDIO_CP_SOURCE_MAP_OPERATION_IDS` (`:774`) — the registry
  test at `oristudioCpCommands.test.ts:12` fails if the two lists disagree, which
  is the intended lockstep.
- `apps/web/src/cp-workspace/tools/inputModelRegistry.ts` — add
  `{ model: 'select-apply' }` for both, beside `Fix1`/`Fix2` (`:184-185`).
  Required regardless of placement: `inputModelRegistry.test.ts:26` asserts every
  `ready()` command has exactly one entry, and `:33` asserts no orphans. Despite
  the name, `select-apply` means "no canvas interaction" — it is what every
  whole-document one-shot already uses.
- `apps/web/src/lib/workspaceCapabilities.ts` — add `cp.deleteExtraVertices` and
  `cp.deleteExtraVerticesIgnoreColor` to the `MenuActionId` union (`:88`) and
  two `capability(canEditCp, …)` entries beside `cp.fix1` (`:740`).
- `apps/web/src/commands/menuActions.ts` — add both ids to `MENU_ACTION_IDS`
  (`:104`) and to `CP_OPERATION_ACTIONS` (`:240`). That map is the whole
  dispatch: `menuActions.ts:374-377` runs any id in it with no payload.
- `apps/web/src/menus/menuDefinition.ts` — add both to the **Repair** submenu
  (`:236-243`), after `cp.fix2`. Same family as Fix1/Fix2: whole-document,
  no-input, no-selection repair.

Tooltips should state the surprising part rather than restate the label:

- Same-colour: *"Merge collinear crease pairs that meet at a vertex, when both
  are the same type"*
- Ignore-colour: *"Merge collinear crease pairs regardless of type — a mountain
  and a valley merge to an edge"*

### Phase 3 — Left-rail button for the ignore-colour variant

This is the one piece with no existing precedent, and it is **not** the two-line
change the first draft of this plan claimed. Correcting that:

The rail already knows how to fire a one-shot. `handleCpToolAction`
(`CreasePatternPanel.tsx:1616`) executes the command inline when the command is
`ready`, has no `toolSteps`, and `cpCommandRequiresContextApply` is false —
which for a command with no tool-setting groups it is
(`CpContextToolPanel.tsx:100-107`). So click-to-run works with no new dispatch
path.

What does *not* work is the active state. Every rail-placed command today is a
mouse tool; **no `select-apply` command is on the rail** — all twenty are `menu`,
`palette`, or `hidden-ui-only`. So this button is the first of its kind, and it
walks into a real problem:

- `handleCpToolAction:1645` calls `setOristudioCpActiveToolId(action.id)`
  *unconditionally*, before the early-returns that decide whether to execute.
- The rail renders `isActive` from `activeActionId === action.id`
  (`CpToolRail.tsx:420-423`, `:470`).

So after the sweep runs, the button latches on and reads as the active tool,
while the canvas has no tool selected and clicks do nothing. That is a bug the
user sees immediately.

The fix: an instantly-executed command should not become the persisted active
tool. Decide execute-vs-activate *before* the state writes rather than after —
hoist the `ready` / `toolSteps` / `cpCommandRequiresContextApply` test into a
single predicate, and skip both `setCpToolState` and
`setOristudioCpActiveToolId` on the execute branch. That predicate belongs
beside the tool modules per the panel-composition rules in `AGENTS.md`, not as
another conditional inside the panel.

Then:

- `apps/web/src/lib/oristudioCpActions.ts` — add an
  `ORIEDITA_RAIL_ACTION_OVERRIDES` entry (`:534-568`) placing it in the `edit`
  group at `railOrder: 15`, between `DeletePoint` (10) and
  `VertexDeleteOnCrease` (20). That is the delete family, and it is where the
  eye already goes for vertex removal.
- `apps/web/src/components/panels/CpToolRail.tsx` — add the
  `ORIEDITA_OPERATION_GLYPHS` entry (`:274`) mapping the new operation to
  ``. The glyph is already in the font under `v_del_all_ccAction`
  (`:266`).

A rail button also needs a `railLabel` short enough not to wrap — "Delete
Extra Vertices (Ignore Colour)" will not fit. Suggest `Merge Collinear`, with
the full label in the tooltip.

### Phase 4 — Shortcut

`apps/web/src/keyboard/shortcuts.ts` — `v_del_allAction: 'ctrl shift V'` already
sits in the upstream-reference table (`:158`) under the comment "chords declared
in `MENU_SHORTCUTS`", but no such chord exists. Add one:

```ts
menuShortcut('cp.deleteExtraVertices', 'Delete Extra Vertices', 'Crease Pattern',
  { primary: true, shift: true, key: 'v' }, 'v_del_allAction')
```

Four notes, checked rather than assumed:

- **`primary: true` is Cmd on macOS and Ctrl elsewhere — nothing is hardcoded.**
  `shortcuts.ts:597` formats it per platform (`platform === 'mac' ? 'Cmd' :
  'Ctrl'`) and `:550` matches on `event.metaKey || event.ctrlKey`. So this ships
  as **Cmd+Shift+V** on Zach's Mac. The literal `'ctrl shift V'` strings at
  `:158` and `:176` are *not* our chords — they are verbatim copies of
  Oriedita's `hotkey.properties`, which is a Java desktop app where Ctrl is
  correct. Wherever this plan writes `Ctrl+Shift+V` about upstream, read it as
  upstream's binding; ours is the platform-aware one.
- **The chord is free today.** The only declared chord using `v` is `edit.paste`
  (`primary+v`, `:189`). This matters because duplicate chords fail silently in
  the dispatcher — a collision would not announce itself.
- **Upstream double-books it.** `hotkey.properties` assigns `ctrl shift V` to
  *both* `v_del_allAction:55` and `pasteOffsetClipboardAction:236`. Our reference
  table faithfully records both (`shortcuts.ts:158`, `:176`) and neither is
  currently bound, so taking it now is safe, but paste-offset will have to pick
  something else if it is ever wired. Worth a comment at the binding so the next
  person does not rediscover it.
- In the browser Cmd/Ctrl+Shift+V is paste-as-plain-text. It only matters inside
  an editable target, and `isShortcutEditingTarget`
  (`keyboard/shortcutDispatcher.ts`) already skips those, so the two do not
  collide in practice.

The ignore-colour variant gets no chord — upstream leaves it unbound
(`hotkey.properties:56`).

### Phase 5 — Fix the O(V·E) sweep before shipping it

`point_line_groups` (`arrangement.rs:963`) is the *un-optimised twin* of
`checks.rs::point_line_map` (`:1165`). `checks.rs` replaced exactly this linear
scan with an eps-cell spatial hash, and its comment records why: the scan "hung
CheckCamv for ~0.85s on a 52k-edge document". `del_v_all` is strictly worse than
that baseline, because it repeats linear work per merge:

| Step | Cost | Location |
| --- | --- | --- |
| Endpoint bucketing | O(E · V) linear scan | `process_point_line_group:999` |
| `remove_line_by_value` ×2 per merge | O(E) each | `arrangement.rs:1024` |
| `replace_line_in_groups` ×2 per merge | O(E) each | `arrangement.rs:1010` |

On a dense CP where most vertices are degree 2 — precisely the input this tool
exists for — that is quadratic in the edge count for the sweep alone. This is
the one phase with real algorithmic content, and it should land before the
action is reachable from the UI, not after a user reports a hang.

Approach, in order of preference:

1. Reuse `checks::point_line_map` instead of `point_line_groups`. It is already
   the spatial-hash version, already skips cyan, and already reproduces
   insertion-order first-match. It needs to become `pub(crate)`-visible to
   `operations::arrangement` (it already is `pub(crate)` in `checks.rs:1165`) and
   to return an index-stable handle rather than cloned `LineSegment`s so
   `replace_line` can be O(1). Deleting the duplicate is worth doing on its own
   merits.
2. Replace value-identity (`remove_line_by_value`, `replace_line_in_groups`
   comparing whole `LineSegment`s) with segment indices plus a tombstone vector.

Keep the observable result identical: this is a data-structure change under a
behaviour that the Java oracle already pins. The existing oracle assertions
(`tests/oriedita_operations_oracle.rs:447-468`) are the regression gate, and this
phase should extend them with a fixture that has (a) a 4+ segment collinear
chain, so progressive re-merging is exercised, and (b) two endpoints within the
1e-4 bucketing epsilon but not identical, so the spatial hash's cell-boundary
behaviour is pinned against Java.

Then add a timing check on a generated dense grid (say 200×200) asserting the
sweep completes in well under a second, so a future regression is caught by
`cargo test` rather than by a user.

### Phase 6 — Decide what a merged crease inherits

`del_v_pair` builds the merged segment with
`LineSegment::with_color(a, b, color)` (`arrangement.rs:771`). That constructor
zeroes every other field, so the merge drops `fold_magnitude`, `customized`,
`customized_color`, and `active` (`geometry/line_segment.rs:113-134`).

`fold_magnitude` is the one that matters. This repo now supports non-180
creases, and `None` means "classic ±180". So **merging two collinear 60°
mountains silently produces a 180° mountain** — a geometry change, not a
cleanup. Oriedita offers no guidance here: it has no fold angles, so upstream
parity is genuinely silent rather than opposed.

This is pre-existing — `del_v_at_point_impl:915` does the same thing, so the
`DeletePoint` tool already has the bug — but a whole-document sweep applies it
everywhere at once, which is how a latent bug becomes a data-loss report.

Recommendation, which needs Zach's call before implementation:

- **Same magnitude on both sides → keep it.** Unambiguous, and the merge is
  genuinely lossless.
- **Different magnitudes → refuse the merge** and leave the vertex. It is a real
  vertex: two creases at different fold angles are not one crease. Skipping is
  the only answer that does not fabricate geometry.
- Carry `customized` / `customized_color` from the first segment, matching the
  colour matrix's own left-biased shape.

Because this adds a refusal condition upstream does not have, gate it so that
documents where every segment has `fold_magnitude: None` — i.e. every Oriedita
import — take the identical code path and stay oracle-clean.

Note for review: `del_v_at_point_impl:915` also passes `lix.color` rather than
running the colour matrix, so `del_v_at_point_color_change` keeps the merged
line's first colour. That is documented as a deliberate Java quirk at
`arrangement.rs:734-737` and is out of scope here — flagged only so the two
paths' different colour handling is not mistaken for a bug introduced by this
work.

### Deliberate scope decisions

- **Split placement, chosen by Zach:** ignore-colour on the left rail *and* in
  Repair; same-colour in Repair only. Upstream puts both in the DrawingTab
  toolbar (`DrawingTab.java:104`), so the rail button also happens to match
  where the screenshot's button lives. The cost is that Ori Studio's rail has
  only ever held *mouse tools* — this is the first one-shot on it. Worth knowing
  before the first build: the piece with no precedent is the rail's "active
  tool" latch (Phase 3), not click-to-run, which already works.

  Superseded note, kept because the correction matters: the first draft of this
  plan called a rail button "two lines" — an
  `ORIEDITA_RAIL_ACTION_OVERRIDES` entry
  (`oristudioCpActions.ts:534-568`) and an `ORIEDITA_OPERATION_GLYPHS` entry
  (`CpToolRail.tsx:274`). Those two lines are real and still needed, but they
  are not sufficient — reading `handleCpToolAction` afterwards turned up the
  active-tool latch. Phase 3 is the accurate version.
- **No `ORIEDITA_CP_TOOL_INSTRUCTIONS` entry.** That module documents multi-step
  mouse tools; Fix1/Fix2 have no entry either.
- **No new undo work.** History snapshots the whole document
  (`projectSlice.ts:1783`). One quirk to accept: the store pushes a history entry
  for any mutating operation whether or not it changed anything, where upstream
  records only on a count change (`CreasePattern_Worker_Impl.java:808`). Fix1 and
  Fix2 already behave this way, so a no-op undo entry here is consistent rather
  than new. Not worth diverging for.

## Affected Areas

- `crates/oristudio-cp/src/lib.rs` — two `OperationId` variants, two descriptors,
  two dispatch arms
- `crates/oristudio-cp/src/operations/arrangement.rs` — Phase 5 sweep rewrite,
  Phase 6 `fold_magnitude` handling
- `crates/oristudio-cp/src/checks.rs` — expose the spatial-hash `point_line_map`
  for reuse
- `crates/oristudio-cp/tests/oriedita_operations_oracle.rs` — chain + epsilon
  fixtures
- `crates/oristudio-cp/tests/operations.rs` — fold-magnitude cases, perf guard
- `apps/web/src/generated/oristudio-cp-wasm/**` — rebuilt bridge (tracked)
- `apps/web/src/lib/oristudioCpCommands.ts` — catalog + source-map ids
- `apps/web/src/cp-workspace/tools/inputModelRegistry.ts` — two `select-apply`
  entries (required by the coverage test regardless of placement)
- `apps/web/src/lib/oristudioCpActions.ts` — rail override for the ignore-colour
  variant
- `apps/web/src/components/panels/CpToolRail.tsx` — rail glyph
- `apps/web/src/components/panels/CreasePatternPanel.tsx` +
  `apps/web/src/cp-workspace/tools/` — execute-vs-activate predicate, so a
  one-shot does not latch as the active tool
- `apps/web/src/lib/workspaceCapabilities.ts` — two capabilities
- `apps/web/src/commands/menuActions.ts` — ids + `CP_OPERATION_ACTIONS`
- `apps/web/src/menus/menuDefinition.ts` — Repair submenu
- `apps/web/src/keyboard/shortcuts.ts` — `primary+shift+V` (Cmd on macOS)
- `apps/web/public/locales/*/{menu,common}.json` — 8 locales
- No Tauri change — this branch's shell has no native menu

## Validation

- `cargo test -p oristudio-cp`; `cargo fmt --check`; `cargo clippy --workspace
  --all-targets -- -D warnings`.
- Oracle parity **is** required — Phase 5 rewrites a ported sweep and Phase 6
  adds a refusal condition. Build the Java oracle and run
  `cargo test -p oristudio-cp --test oriedita_operations_oracle`.
- `wasm-pack build` for the CP bridge, and commit the rebuilt `.wasm`.
- `cd apps/web && npx tsc --noEmit` and
  `npm --workspace @treemaker/web exec -- vitest run` — the `typecheck:web` /
  `test:web` scripts regenerate tracked `apps/web/src/generated/**`
  nondeterministically.
- `npm run lint:web`.
- `npm run i18n:extract`, translate the new `menu:` and `common:capability.*`
  keys in all 8 locales, `npm run i18n:stamp`, then `npm run i18n:check`.

Browser checklist for Zach (not tool-verifiable):

- Draw a straight line as two strokes; ignore-colour merge collapses it to one.
- Same colour: two collinear mountains merge; a mountain meeting a valley does
  not. Ignore-colour: that same pair merges and comes out as an **edge**.
- A real corner (two creases at an angle) is never merged by either.
- A vertex where two collinear creases meet *and* an aux line ends: the merge
  still happens and the aux endpoint is left dangling. This is upstream
  behaviour, but confirm it looks acceptable in the app.
- Two collinear 60° mountains: confirm Phase 6's choice — either the angle
  survives the merge, or the vertex is left alone. Neither should become 180°.
- Undo restores the removed vertices.
- **Rail button:** clicking it runs the sweep once and does *not* stay lit
  afterwards; the previously active tool is unaffected and the canvas still
  responds to it. Clicking it twice runs it twice (the second run is a no-op).
- The rail label does not wrap or truncate at the narrowest rail width, and the
  tooltip carries the full name.
- `Cmd+Shift+V` (Ctrl elsewhere) fires the same-colour variant, and does nothing
  harmful while a text annotation is being edited.
- Run it on a large imported CP and confirm it does not lock the UI.

## Checklist

- [x] Phase 1 — `OperationId`s, descriptors, dispatch arms; wasm rebuilt and committed
- [x] Phase 2 — command catalog, input-model entries, capabilities, menu action map, Repair submenu (both actions)
- [x] Phase 3 — execute-vs-activate predicate so a one-shot does not latch the rail
- [x] Phase 3 — rail override + glyph. No rail label needed after all: command
      actions never set `railLabel`, so the rail is icon-plus-tooltip and the
      truncation worry did not apply.
      **Later revision:** the rail entry is the *same-type* variant, not the
      ignore-type one this plan assumed. The rail should carry the variant that
      has a keybinding, so the two ways of reaching it agree; the ignore-type
      sweep stays in the Repair menu, where its longer label has room to say how
      it differs.
- [x] Phase 4 — `primary+shift+V` chord (verified free; upstream double-books it with paste-offset)
- [x] Phase 5 — sweep rewritten on segment indices + eps-cell spatial hash; 1.35s -> 0.01s
      on a 10k-segment dense grid. `checks::point_line_map` was not reusable as-is —
      it returns cloned segments with no identity, and `replaceLine` needs an
      exact-coordinate vertex lookup — so `arrangement` grew its own index rather
      than the planned shared one. The duplicate scan is gone either way.
- [x] Phase 5 — oracle fixtures for collinear chains and epsilon-boundary endpoints.
      The chain fixture caught a real divergence: `replaceLine` removes and
      re-appends, which reorders the pair the next vertex sees and flips the merged
      endpoints. Fixed.
- [x] Phase 5 — dense-grid timing guard
- [x] Phase 6 — `fold_magnitude`: Zach chose same-angle-merges / different-angles-refuse.
      Applied to `del_v_at_point` as well, not just the sweep — `DeletePoint` is the
      same merge at one vertex, and the two disagreeing would be a defect. A pair
      that resolves to an edge drops the angle, since an edge has none. Invisible
      to all-classic documents, so the oracle is unaffected.
- [x] i18n: extract, 8 locales, stamp, check
- [x] `cargo fmt` / `clippy` / `cargo test -p oristudio-cp` / oracle / `tsc --noEmit` / `lint:web` / `vitest`
- [ ] Browser checklist confirmed

Pre-existing on this branch, untouched by this work: `symmetric_draw`,
`double_symmetric_draw` and `fishbone_draw` fail against the Oriedita oracle.
They are in `operations::construction`, which no commit here edits.
