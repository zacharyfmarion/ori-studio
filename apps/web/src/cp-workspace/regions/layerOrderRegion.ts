/**
 * The crease pattern a Layer order fold came from, as a host hands it to the
 * dialog (`LayerOrderRequest.region`): the sheet its creases lie on, out of a
 * document that may hold hundreds, chosen the one way a Diagram step's link
 * chooses one (`regionCreases.ts`). The dialog's crease-pattern pane then
 * shows that pattern alone, framed on its paper.
 *
 * - A Diagram step and Pose hold their sheet's creases already
 *   (`StepCreases`): {@link layerOrderRegionOf}.
 * - Edit's figure and selection know the lines they fold:
 *   {@link layerOrderRegionOfLines} finds the sheet that holds them.
 *
 * Only what is drawn and framed comes from here. The faces are the kernel's,
 * from the source, so picking, letters and tints are where they were.
 */
import type { OristudioCpDocumentSnapshot } from '../../engine/oristudioCpTypes';
import { selectedFoldableCpLineIds } from '../../lib/creasePatternClipboard';
import { emptyOristudioCpSelection } from '../../lib/creasePatternViewport';
import type { LayerOrderRegion } from '../../lib/layerOrder/layerOrderRequest';
import { cpLinesByIds } from '../folded/foldedFigureStaleness';
import { ensureCpSheetIndex, peekCpSheetIndex } from '../sheets/cpSheetIndex';
import { sheetHoldingLines } from '../sheets/selectedSheet';
import { creasesOfSheet, type StepCreases } from './regionCreases';

/** A sheet's creases as the dialog's region: its paper, and its lines that fold nothing. */
export function layerOrderRegionOf(
  document: OristudioCpDocumentSnapshot,
  creases: Pick<StepCreases, 'scopedLineIds' | 'foldLineIds' | 'paper'>
): LayerOrderRegion {
  const folded = new Set(creases.foldLineIds);
  return {
    paper: creases.paper,
    auxSegments: cpLinesByIds(
      document,
      creases.scopedLineIds.filter((id) => !folded.has(id))
    ),
  };
}

/**
 * The region of the sheet a fold of `lineIds` (1-based, as a selection holds
 * them) came from: the one that holds every line it folds, its foldable ones,
 * as `resolveFoldRoute` takes them. Null when they lie on no one sheet:
 * outside every closed border, or across two.
 */
export async function layerOrderRegionOfLines(
  document: OristudioCpDocumentSnapshot,
  lineIds: readonly number[]
): Promise<LayerOrderRegion | null> {
  const folded = selectedFoldableCpLineIds(document, { ...emptyOristudioCpSelection(), lines: [...lineIds] });
  const index = peekCpSheetIndex(document) ?? (await ensureCpSheetIndex(document));
  const sheet = sheetHoldingLines(index, folded);
  const creases = index && sheet !== null ? creasesOfSheet(document, index, sheet) : null;
  return creases ? layerOrderRegionOf(document, creases) : null;
}
