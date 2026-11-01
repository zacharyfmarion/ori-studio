/**
 * The layer orders chosen in the Export crease pattern dialog and the Share
 * modal, for the app session
 * (`implementation-plans/spread-and-layer-order-in-edit-export-share.md`,
 * decision 3): the export's own, so no undo entry and nothing written to the
 * document, kept in memory by the digest of the fold they were chosen on, so
 * Export and Share of the same creases reopen on the same order and turn.
 *
 * A digest names the folded creases, the starting face and every face ring
 * (`LayerOrderSource.digest`), never a side or a colour, so the order holds
 * through them: its relations name faces from the starting face's front.
 * Creases edited since make another digest, which has no order.
 *
 * React-free: a zustand store the dialogs' hook reads (`useExportLayerOrder`).
 */
import { create } from 'zustand';
import type { LayerOrderDialogOutcome } from '../../layer-order/dialog/layerOrderDialogGateway';
import { keyDigest } from '../../lib/keyDigest';
import { encodeLayerOrderRecord } from '../../lib/layerOrder/layerOrderRecord';
import type { LayerOrderApplied } from '../../lib/layerOrder/layerOrderRequest';
import type { FoldedFigureOrder } from '../folded/useFoldedFigurePreview';

/** What the session keeps for one fold's creases. */
export interface ExportLayerOrder {
  /**
   * The order the dialog's last Apply chose, with its JSON (the record as the
   * dialog's next opening is handed it) and the key its pictures are cached
   * by; null when only the turn was set (an Apply that changed no order).
   */
  readonly chosen: (FoldedFigureOrder & { readonly json: string }) | null;
  /** How far Rotate in the dialog turned the figure, clockwise on screen from its side, in degrees. */
  readonly turnDeg: number;
}

interface ExportLayerOrdersState {
  readonly byDigest: Readonly<Record<string, ExportLayerOrder>>;
}

export const useExportLayerOrders = create<ExportLayerOrdersState>()(() => ({ byDigest: {} }));

/** The chosen order an Apply hands back, as the session keeps it. */
export function exportLayerOrderOf(applied: LayerOrderApplied, json: string): ExportLayerOrder['chosen'] {
  return { applied, json, key: keyDigest([json], 'xlo1:') };
}

/**
 * What the Layer order dialog's answer leaves kept for a fold's creases,
 * from what was kept (`kept`); null when it changes nothing:
 *
 * - `applied`: its order, and the turn when Rotate left one, else the turn
 *   that was kept;
 * - `unchanged` with a turn: the turn alone, any order kept as it was (D16);
 * - `unchanged` with none, `cancelled`, `busy`, `unavailable`: nothing.
 *
 * A record the dialog applied always encodes (its Apply refuses one past the
 * budget); one that would not is no order to keep.
 */
export function exportLayerOrderAfter(
  kept: ExportLayerOrder | null,
  answer: LayerOrderDialogOutcome
): ExportLayerOrder | null {
  switch (answer.kind) {
    case 'applied': {
      const encoded = encodeLayerOrderRecord(answer.applied.record);
      if (!encoded.ok) return null;
      return { chosen: exportLayerOrderOf(answer.applied, encoded.json), turnDeg: answer.turnDeg ?? kept?.turnDeg ?? 0 };
    }
    case 'unchanged':
      return answer.turnDeg === undefined ? null : { chosen: kept?.chosen ?? null, turnDeg: answer.turnDeg };
    case 'cancelled':
    case 'busy':
    case 'unavailable':
      return null;
  }
}

/** Keep `entry` for the creases of `digest`, in place of whatever was kept for them. */
export function rememberExportLayerOrder(digest: string, entry: ExportLayerOrder): void {
  const { byDigest } = useExportLayerOrders.getState();
  useExportLayerOrders.setState({ byDigest: { ...byDigest, [digest]: entry } });
}

/** What the session keeps for the creases of `digest`, or null. */
export function exportLayerOrderFor(digest: string): ExportLayerOrder | null {
  return useExportLayerOrders.getState().byDigest[digest] ?? null;
}

export function resetExportLayerOrdersForTest(): void {
  useExportLayerOrders.setState({ byDigest: {} });
}
