# Fold: Collapse along existing creases

## Goal

A Fold rail tool, **Collapse**, that collapses the state on screen along
creases it already has:

1. the folder picks existing creases — flat precreases, or creases already
   folded — on either pane;
2. sets each to Valley, Mountain or Open (flat);
3. the engine lands the result, and the folder chooses the layer order.

The tool draws no line. A line the state does not have yet comes from a
Precrease step before the Collapse.

Why: saved Import CP ("cp-jump") steps that are collapses along existing
creases store a snapshot of a crease pattern, which goes stale when an
earlier step changes. A Collapse stores only the letters it changes and the
order chosen, and is derived from its parent each time it replays.

## Approach

**Engine (`oristudio_fold::collapse`).** A Collapse is Import CP of a crease
pattern derived in place: the parent's own pattern
(`CreasePatternInput::of_state`) with the named creases' letters changed,
imported after the parent (`ImportTarget::After`). So the assignment folds
flat the way an import does, its orders are an import's ‹ n of m ›, and it
lands where a saved cp-jump of the same pattern lands after the same parent
(the view kept, the root continued).

- A stored stretch `{ a, b, to }` names every parent crease along it, whole,
  and the parts of crease marks it covers, by sheet geometry. A gap, an end
  inside a crease, or a crease named two ways refuses
  (`collapse_crease_missing`, `collapse_crease_twice`).
- Open leaves a crease flat, remembering the letter it had.
- Every inside vertex the folded creases meet at is checked against Maekawa
  and Kawasaki first, so a bad assignment is refused at its vertex
  (`collapse_not_flat_at_vertex`, with the point).
- Creases the Collapse leaves alone keep their parent's `made_at`; changed
  ones get the Collapse's step, so the step's instruction is what changed.

**Op.** `{ kind: 'collapse', creases: [{ a, b, to: 'mountain' | 'valley' | 'open' }], orderJson }`:
the stretches, merged and sorted into one canonical list, and the order
itself as a `WitnessOrder` (the way `adjust-order` stores one), never an
index into a listing.

**Wasm.** `collapse_open(state, creases, limits)` holds the derived pattern
and its completions under an import handle (the `Imports` store, whose held
pattern now knows whether it came from a file or a Collapse);
`collapse_op(import, choice)` answers the op an order lands, landing
nothing. `Bridge::apply` lands a stored `collapse` by deriving and replaying
(`io::collapse::land`), held as a view change is, so its summary is the diff
from its parent. The Layer order dialog does not open on a Collapse yet: its
flat creases split faces Edit's fold joins (`import_layer_unavailable`,
reason `collapse`).

**Web.** A rail tool in the Model group. The folder holds a letter
(Valley / Mountain / Open) and clicks creases on either pane: hover lights
the crease under the pointer, a click sets it to the letter in hand (a click
on a crease already set so unsets it). Picked creases are drawn in the
paper's mountain/valley diagram pens on the folded pane and in Edit's crease
look on the crease pattern. The landing previews live as letters change,
through the session's own preview; several orders are reviewed with the
existing ‹ n of m › chooser before the step is added. A refusal shows in the
window's reserved message line and marks its vertex.

## Affected Areas

- `crates/oristudio-fold/src/collapse.rs` (new), `import/mod.rs`,
  `unordered.rs`, `lib.rs`; tests in `crates/oristudio-fold/tests/collapse.rs`.
- `crates/oristudio-fold-wasm/src/io/{collapse.rs,imports.rs,wire.rs,bindings.rs}`,
  `wire.rs`, `resolve.rs`; tests in `crates/oristudio-fold-wasm/tests/collapse.rs`.
- `apps/web/src/fold/creaseCollapse/` (new): the tool's hook, window, picks
  and marks. Named apart from `fold/collapse/`, which is the linked Import
  CP from Edit's document.
- Document reader/writer, step words and sentences, rail, catalog, glyph,
  keyboard, analytics, Diagram sentence, Repeat refusal, worker and engine
  calls.

## Checklist

- [x] Engine: derived pattern, stretch matching, vertex checks, `made_at`
- [x] Wasm: op, landing, `collapse_open`, `collapse_op`, held source
- [ ] Rust tests (engine and wasm), fmt, clippy
- [ ] Corpus: the 18 cp-jump cases swapped, 0 differ, check-model OK
- [ ] Corpus: all 113 models replay as on main
- [ ] Web: document op, reader/writer, words, sentence, Diagram, Repeat
- [ ] Web: rail tool, glyph, key, window, picks and marks, preview, orders
- [ ] Web: analytics
- [ ] Web: lint, typecheck, vitest
- [ ] Browser walkthrough and draft PR
