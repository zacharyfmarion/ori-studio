# Fold samples

Crease patterns that ship with Ori Studio's Fold workspace as Import CP
samples (`implementation-plans/fold-workspace.md`, D16). The web app bundles
them (`apps/web/src/fold/engine/foldEngineIoSamples.ts`), and an import of
one is stored with `origin: 'sample'`.

| File | Base | Letters |
| --- | --- | --- |
| `preliminary-base.fold` | The preliminary (square) base | Midline halves M; the side quadrants' half-diagonals V; the front and back quadrants' half-diagonals precreases remembering V |
| `waterbomb-base.fold` | The waterbomb base | Half-diagonals M; two opposite midline halves V; the other two precreases remembering M |
| `pleat-in-eighths.fold` | A square pleated in eighths | Seven parallel creases, V and M in turn from the left edge |

**Provenance.** The bases are traditional, with no known author; each file
says so in `file_author`. The preliminary and waterbomb assignments are the
Fold research's sink spike's (`research/2026-10-08-fold-workspace/r2-spike-sinks.md`,
"Starting states: CP importer"), where each imported to exactly one layer
order of the 18 the geometry alone allows. The files were written for Ori
Studio, which offers them under the same terms as the engine they ship with
(MIT OR Apache-2.0; see `LICENSING.md`).

**Format.** FOLD 1.1, on the unit square, y down as Ori Studio's FOLD reader
places a pattern (so they open in Edit as drawn here). A precrease is FOLD's
unassigned `U` with Ori Studio's `oristudio:edges_fold_direction_hint`
extension (`1` mountain, `2` valley); a reader without the extension sees an
unassigned crease.

`crates/oristudio-fold-wasm/tests/io.rs` checks that each imports to its one
order with its precreases, and `apps/web/src/fold/engine/foldEngineIo.wasm.test.ts`
imports them through the built bridge.
