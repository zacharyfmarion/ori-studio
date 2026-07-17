# CP text annotation creation — UX & implementation plan

> **Status: implemented.** All six phases landed (engine `CreateAt`, canvas text
> mode, inline editor, drag/right-click/Delete, panel re-scope, round-trip proof).
> `cargo test -p oristudio-cp`, `tsc`, `vitest`, and `eslint` are green; the ori +
> FOLD round-trip test guards Oriedita compatibility. Browser checklist (§7) is the
> remaining author-owned verification.

**Goal.** Let users *create* text annotations on the crease-pattern canvas by
clicking with the Text tool, edit them inline where they sit, drag them to
reposition, and delete them — matching Oriedita's `MouseHandlerText` behaviour
closely enough that `.ori`/FOLD round-trips stay byte-compatible.

**The headline finding:** the engine is already done. The Rust port of
Oriedita's text handler is complete and oracle-tested, and both export formats
already round-trip text. **Every missing piece is in the frontend.** This is a
UI wiring job with one small, well-scoped engine addition — not a port.

---

## 1. What already exists

### Engine — complete
[operations/text.rs](../crates/oristudio-cp/src/operations/text.rs) is a faithful
port of [`MouseHandlerText.java`](../third_party/oriedita/oriedita/src/main/java/oriedita/editor/handler/MouseHandlerText.java):
`text_create_or_select_pressed`, `text_drag_selected`, `text_delete_at`,
`text_delete_box`, plus `TextSelectionState` (`selected` / `is_selected` /
`dirty` / `selection_start`) mirroring `SelectedTextModel`.

Pinned by [text_operations.rs](../crates/oristudio-cp/tests/text_operations.rs)
and the Oriedita oracle suite
([oriedita_operations_oracle.rs:2682](../crates/oristudio-cp/tests/oriedita_operations_oracle.rs:2682)).

### Command layer — complete
[`execute_text_command`](../crates/oristudio-cp/src/lib.rs:3474) already dispatches
six actions: `Create`, `Move`, `SetContent`, `DeleteSelected`, `DeleteAt`,
`DeleteBox`. Text IDs are **one-based** at the boundary, zero-based internally
([`required_text_indices`](../crates/oristudio-cp/src/lib.rs:3313)).

### Export — complete, and it constrains the design
| Format | Encoding | Code |
|---|---|---|
| `.ori` | `"texts"` array | [ori.rs:209](../crates/oristudio-cp/src/io/ori.rs:209) |
| FOLD | `oriedita:texts_coords` + `oriedita:texts_text` (parallel arrays) | [fold.rs:384](../crates/oristudio-cp/src/io/fold.rs:384) |

Both mirror Oriedita's [`MapTextAdapter`](../third_party/oriedita/oriedita-data/src/main/java/oriedita/editor/save/fold/MapTextAdapter.java)
exactly. See §4 for what this forbids.

---

## 2. The actual gap

`Text` is declared as a `bespoke` input model at
[inputModelRegistry.ts:156](../apps/web/src/cp-workspace/tools/inputModelRegistry.ts:156) —
the registry comment even lists it alongside SquareBisector and Voronoi — but
**no bespoke canvas handler was ever written for it.** Nothing in the pointer
path branches on `Text`. Consequences:

1. **No creation.** The `Create` action is never dispatched from TypeScript. The
   only reachable actions are `SetContent`
   ([CreasePatternPanel.tsx:1476](../apps/web/src/components/panels/CreasePatternPanel.tsx:1476))
   and `DeleteSelected`
   ([:1543](../apps/web/src/components/panels/CreasePatternPanel.tsx:1543)).
2. **The Text tool can't even select text.** `CpTextOverlay`'s `selectable` prop
   is `cpToolState.phase !== 'active' || allowsDirectEntitySelection(...)`, and
   [`allowsDirectEntitySelection`](../apps/web/src/cp-workspace/tools/predicates.ts:36)
   returns true *only* for `CreaseSelect`. So activating the Text tool makes the
   overlay click-through, and `handleEditableTextClick`
   ([:2311](../apps/web/src/components/panels/CreasePatternPanel.tsx:2311))
   early-returns.
3. **No drag/move.** `Move` is never dispatched.
4. **Editing happens in the wrong place** — a side-panel textarea
   ([CpContextToolPanel.tsx:563](../apps/web/src/components/panels/CpContextToolPanel.tsx:563))
   behind an explicit Apply, not at the text's location.

So today's only path is: *deactivate all tools → click a text → activate Text
tool → type in the side panel → Apply.* Creation is impossible.

Worth noting: the tool's own help text at
[oristudioCpToolInstructions.ts:354](../apps/web/src/lib/oristudioCpToolInstructions.ts:354)
already promises the Oriedita UX — *"Create text box"*, *"Press ESC or click
anywhere to apply edit. Right click on text to delete it."* The help is written
against behaviour that doesn't exist. This plan makes the app match its own docs.

---

## 3. Oriedita's UX (the oracle)

From `MouseHandlerText` + [`TextEditingArea`](../third_party/oriedita/oriedita-ui/src/main/java/oriedita/editor/swing/component/TextEditingArea.java):

| Input | Behaviour |
|---|---|
| L-click empty space, nothing selected | Create **empty** text at that point, select it, focus an inline editor there |
| L-click on a text | Select it; inline editor moves to it |
| L-click empty space, something selected | Deselect; commit undo if dirty |
| L-drag a selected text | Move it (`setX/setY` by pointer delta) |
| Type | Mutates the model live; marks dirty |
| ESC | Hide editor, deselect |
| Blur | Commit: drop blank texts, `record()` if dirty |
| R-click a text | Delete nearest |
| R-drag a box | Delete all texts intersecting the box |

Two behaviours that are easy to miss and matter a lot:

- **Blank-text GC.** A text left empty is silently removed — on selection change
  (`TextEditingArea:47`) and on blur (`:85`). This is what makes "any click
  creates a text" tolerable: stray clicks self-clean.
- **Undo granularity.** `d.record()` fires on *commit* points (deselect, blur,
  delete) — **never per keystroke**. One edit session = one undo entry.

Cursor feedback (`updateCursor`): move-cursor over the selected text,
text-cursor over any other text, default elsewhere.

---

## 4. The hard constraint: `TextElement` is `(x, y, text)`

```rust
pub struct TextElement { pub x: QuantizedFloat, pub y: QuantizedFloat, pub text: String }
```

Because both exporters serialise exactly these three fields into Oriedita's
schema, **any styling we add to the model — font size, colour, rotation,
alignment, bold — silently drops on export.** A user who styles text and saves
to `.ori` loses it with no warning.

**Decision: the model stays `(x, y, text)`.** Rendering style is global/viewport
state (`BASE_FONT_PX`, theme colour), not per-text. If per-text styling is ever
wanted, it needs a deliberate conversation about a non-Oriedita namespace
(`oristudio:texts_*` extras) — explicitly out of scope here.

This also means: **no multi-line ambiguity to invent.** Oriedita stores `\n`
inside the string and renders line-by-line
([TextWorker:34](../third_party/oriedita/oriedita-data/src/main/java/oriedita/editor/canvas/TextWorker.java:34)).
We keep `\n`, so the inline editor must be a `textarea`, not an `input`.

---

## 5. Design decisions

### D1 — Inline canvas editor is the primary surface ✅
Replace the side-panel-and-Apply flow with a `<textarea>` positioned over the
text's anchor inside `CpTextOverlay`, mirroring `TextEditingArea`. Editing
annotations *where they live* is the whole point of the feature, and it's what
Oriedita does.

*Keep* the panel textarea, but re-scope it to **bulk edit of a multi-selection**
(`SetContent` across N texts) — it's the one thing inline editing can't do. When
exactly one text is selected, the panel field becomes a read-only mirror to
avoid two live editors fighting over one value.

### D2 — Frontend owns hit-testing; engine owns mutation ✅
**Do not call `DeleteAt` / `DeleteBox` from the web.** Both resolve hits through
`find_nearest_text` → `text_selection_bounds`, which uses a **fixed 25×3 box in
model space under an identity camera** — a stand-in for Java's `FontMetrics`,
which the Rust crate has no access to. Under our camera that box has nothing to
do with where glyphs actually appear, so hits would land wrong at any zoom.

The DOM overlay already has real, correct bounds for free (`getBoundingClientRect`
on the rendered `<span>`). So: **frontend hit-tests, engine mutates by index.**
The engine's identity-camera ops stay untouched for the oracle tests; the web
simply uses the index-addressed actions (`CreateAt`, `Move`, `SetContent`,
`DeleteSelected`).

### D3 — Add `TextCommandAction::CreateAt` (unconditional append) ✅
The existing `Create` is **press semantics, not create semantics**: it routes
through `select_or_create_text`, which calls `try_select_text` first and appends
only on a miss ([text.rs:114](../crates/oristudio-cp/src/operations/text.rs:114)).
`execute_text_command` then returns `Ok(0)` when the count didn't grow
([lib.rs:3480](../crates/oristudio-cp/src/lib.rs:3480)).

Combined with D2 this is a live footgun: the frontend decides "empty space" from
real glyph bounds, but the engine re-decides using its 25×3 model-space box
(≈38×18 with padding). Click near an existing text and the two disagree — the
command reports success-with-zero-changes and **no text appears**. A silent
no-op is the worst possible failure for a creation tool.

Fix: a new action that appends unconditionally at a point with given content.
Small, additive, leaves the ported parity path alone.

### D4 — Draft state locally; one command on commit ✅
Keystrokes mutate React draft state only. A `SetContent` (or `CreateAt` for a
new text) fires on commit — blur, ESC, tool change, or selecting another text.

*Why:* per-keystroke WASM dispatch would mean a command + document round-trip per
character, and an undo entry per character. Oriedita's dirty/`record()` split
exists for exactly this reason; D4 is the React translation of it.

### D5 — Blank texts are dropped on commit ✅
Parity with `TextEditingArea`, and it's what makes D6 safe.

### D6 — Click-on-empty-space creates, no snapping ✅
Parity. Text is annotation, not geometry — it shouldn't land on grid
intersections, and Oriedita snaps it to nothing (`TV2object`, raw). D5 cleans up
strays.

### D7 — Right-click deletes; `Delete` key also works ✅
Parity for right-click (via D2 hit-testing + `DeleteSelected`, not `DeleteAt`).
Box-delete on right-drag is parity too but lower value on the web — **deferred to
a follow-up** unless it falls out cheaply. The `Delete`/`Backspace` key on a
selection is a web convention Oriedita lacks; add it.

---

## 6. Phases

### Phase 1 — Engine: `CreateAt` (Rust)
- Add `TextCommandAction::CreateAt` to the action enum + TS type mirror
  ([oristudioCpTypes.ts:361](../apps/web/src/engine/oristudioCpTypes.ts:361)).
- `execute_text_command`: append `TextElement::new(p.x, p.y, content)`
  unconditionally, return `1`.
- Do **not** touch `text_create_or_select_pressed` or its oracle tests.
- Tests in `text_operations.rs`: creates near an existing text (the case `Create`
  fumbles), creates with content, creates blank.

*Self-verified:* `cargo test -p oristudio-cp`.

### Phase 2 — Overlay: hit-testing + selection under the Text tool
- Teach `CpTextOverlay` to be interactive when the Text tool is active: extend
  the `selectable` predicate rather than special-casing `phase` at both call
  sites (`predicates.ts` gains a text-tool clause).
- Real-bounds hit-testing off the rendered spans (D2).
- Cursor feedback: move-cursor on the selected text, text-cursor on others
  (parity with `updateCursor`).

*Self-verified:* `npx tsc --noEmit`, vitest on `predicates.test.ts`.

### Phase 3 — Inline editor
- `<textarea>` inside the overlay, anchored at the text position, zoom-scaled
  font to match the rendered span, autofocus on select/create.
- Draft state + commit on blur / ESC / selection-change / tool-change (D4).
- Blank-text GC on commit (D5).
- ESC closes and deselects; `Enter` inserts a newline (multi-line, per §4).

*Self-verified:* vitest component tests for the commit matrix.

### Phase 4 — Create + move on canvas
- The missing bespoke handler: pointer-down on empty space with the Text tool →
  `CreateAt` at the model point (D6), select, open editor.
- Pointer-down on a text → select + open editor. Drag → `Move` (single command on
  pointer-up, not per-frame — same reasoning as D4).
- Right-click a text → delete (D7).

*Self-verified:* vitest for the handler state machine.

### Phase 5 — Panel re-scope + cleanup
- Panel textarea → bulk multi-select edit; read-only mirror at N=1 (D1).
- Remove the now-dead single-select Apply path and the sync effect at
  [:2461](../apps/web/src/components/panels/CreasePatternPanel.tsx:2461).
- `Delete`/`Backspace` on a text selection (D7).
- Reconcile the help text at `oristudioCpToolInstructions.ts:354` with the
  now-real behaviour.

*Self-verified:* `npx tsc --noEmit`, full vitest, eslint.

### Phase 6 — Round-trip proof
- Rust: create texts → export `.ori` and FOLD → re-import → assert identical.
  This is the export-compat gate the whole plan is written around.
- Confirm a `.ori` written by us opens in Oriedita with text intact (manual,
  one-time).

---

## 7. Browser checklist (author-verified)

1. Text tool → click empty canvas → text box appears **at the click point**, focused.
2. Type, click away → text persists; **one** undo entry undoes the whole edit.
3. Click empty canvas → click away without typing → no stray empty text.
4. Click a text → drag → it moves; undo restores position in one step.
5. **Click ~20px to the right of an existing text → a NEW text is created** (the D3 regression case; this silently no-ops with the old `Create`).
6. Right-click a text → deleted.
7. ESC while editing → editor closes, text kept.
8. Zoom to 300% → text and editor stay aligned with the anchor; click targets land.
9. Multi-line: type `a⏎b` → renders two lines; survives save/reload.
10. Save `.ori`, reload → text intact at the same coordinates.

---

## 8. Risks

| Risk | Mitigation |
|---|---|
| Engine/frontend hit-test disagreement causing silent no-ops | D2 + D3 — frontend is the sole hit-test authority; `CreateAt` never second-guesses it |
| Per-keystroke commands tanking perf / flooding undo | D4 draft state; commit on Oriedita's `record()` points |
| Styling requests creeping into the model and breaking export | §4 — model frozen at `(x,y,text)`; styling is viewport state |
| Inline editor vs. panel field fighting over one value | D1 — panel is read-only at N=1 |
| Textarea stealing keys from canvas shortcuts | Scope shortcut handling to blur; ESC is the explicit exit |

---

## 9. Explicitly out of scope

- Per-text styling (font, colour, rotation) — breaks Oriedita export (§4).
- Right-drag **box** delete — parity, low web value (D7); follow-up.
- Text on the folded-form / BP surfaces — CP edit surface only.
