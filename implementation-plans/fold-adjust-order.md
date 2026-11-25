# Fold: Adjust order

## Goal

A Fold rail tool, **Adjust order**, that adds a step changing only the layer
order of the paper on screen: every crease, the shape and the pose stay as
they are. Its window offers one thing, to open the Layer order dialog (the one
Fold's Import CP opens) on the current step's paper and its current order.
Apply adds one step that stores only the new order; Cancel, or an Apply that
changed nothing, adds none. The dialog's Rotate is hidden for it, and neither
a turn nor its Front/Back side is ever written to the step.

A tuck that folds stays a Valley or Mountain layer-order choice, as it is
today; this tool is only for re-ordering with no fold.

## Approach

1. **Engine: the parent's own parts, ordered again.**
   `oristudio_fold::reorder::Reordering` is the parent state's parts
   (vertices, creases with their `made_at`, faces with their lineage, crease
   marks, root, view), one step on, with no order: an `Unordered` whose
   letters are all known. Replay resolves the stored `WitnessOrder` against
   it with the letters (`Unordered::replay`), exactly as an import's order
   does, so no geometry is rebuilt and nothing can move.
2. **Engine: the dialog's faces.** The dialog analyses the state's crease
   pattern as Edit folds it whole (`fold_cp_to_model`, then the CP kernel's
   own selection fold, as Import CP's opening does). Edit folds no precrease,
   so one of its faces can be several of the state's, joined across flat
   creases. `steer::StateFaces` matches them many to one, checked both ways
   and by area; it carries the state's order into the dialog's relations
   (the `shown` scene the dialog opens on) and the dialog's Apply back as
   seeds over the state's faces, every overlapping pair fixed as it chose.
   The letters and those seeds must decide the order; anything else refuses.
3. **Wasm:** `adjust_order_opening(state)` and `adjust_order_pick(state,
   digest, relations)`, stateless: the pick recomputes the match from the
   state and checks the digest. The pick lands the `adjust-order` op through
   `Bridge::apply`, the replay's own path, so a committed step is what every
   replay lands. Held as a view change is, so its step summary is the diff
   from its parent: none.
4. **Document:** a new op kind, `{ kind: 'adjust-order', orderJson }`. An
   older build reads an unknown kind as a locked step, kept verbatim and
   written back unchanged, so it never misreads one.
5. **Web:** the tool in the rail's Model group, after Rotate, with the layer
   order's own mark (the two sheets Fold with layer order… wears in Edit,
   `components/ui/LayerOrderIcon.tsx`) and Shift+T, beside Turn over; a
   window with a hint and one button; a hook
   (`fold/order/useFoldAdjustOrderTool.ts`) that asks
   the engine for the opening while the tool is in hand, opens the dialog
   through its gateway with `rotate: false`, and commits Apply's landed step
   through the session (`commitLanded`), so it lands once.
6. **Dialog:** a request option, `rotate: false`, leaves the folded pane's
   Rotate out; the Fold host also ignores any turn and the side.
7. **Words, Diagram, analytics:** the step's words and sentence in every
   locale; Diagram renders it with no arrow; `fold step added` gains the op
   kind.

## Affected Areas

- `crates/oristudio-fold/src/reorder.rs`, `steer/state_faces.rs`,
  `steer/imported.rs` (the look, shared)
- `crates/oristudio-fold-wasm/src/io/reorder.rs`, `io/bindings.rs`,
  `io/wire.rs`, `wire.rs`, `resolve.rs`
- `apps/web/src/fold/document/` (op type, reader, writer)
- `apps/web/src/fold/engine/` (io calls and wire), `workers/foldSequenceWorker.ts`
- `apps/web/src/fold/tools/` (catalog, rail groups, window), `fold/order/`
- `apps/web/src/layer-order/` and `lib/layerOrder/layerOrderRequest.ts`
  (the `rotate` option, the `fold_adjust_order` surface)
- `apps/web/src/keyboard/` (the shortcut), `components/fold/` (glyphs)
- Step words and sentences, Diagram's Fold sentence, every locale catalog

## Checklist

- [x] Engine: `Reordering`, its replay, crate tests on synthetic models
- [x] Engine: `StateFaces`, the opening and the pick, tests with precreases
- [x] Wasm: `adjust-order` op, opening and pick bindings
- [x] Document: the op kind, reader and writer, locked in an older build
- [x] Dialog: `rotate: false` hides Rotate
- [x] Tool: rail item, shortcut (Shift+T), window, hook, commit, analytics
- [x] Words and sentences in every locale; Diagram renders the step
- [x] Real models' layer-order-only Import CP steps rebuilt as Adjust order
      steps, same paper at every later step; saved models replay unchanged
- [x] Browser check through the tool and the dialog; test page
