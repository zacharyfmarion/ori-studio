/**
 * What the Export crease pattern dialog and the Share modal hand the Layer
 * order dialog for their folded figure
 * (`implementation-plans/spread-and-layer-order-in-edit-export-share.md`,
 * approach §1, "The host"). Pure: `useExportLayerOrder` gathers the parts.
 */
import type { OristudioCpFoldedPaperScene } from '../../engine/oristudioCpTypes';
import type { OristudioCpLineStyle } from '../../lib/creasePatternViewport';
import type { FoldedFigureSide } from '../../lib/foldedFigureSides';
import type { LayerOrderRecord } from '../../lib/layerOrder/layerOrderRecord';
import type {
  LayerOrderRegion,
  LayerOrderRequest,
  LayerOrderSource,
} from '../../lib/layerOrder/layerOrderRequest';
import type { PaperStyle } from '../../lib/paper/paperStyle';
import { PAPER_STYLE_POLICIES } from '../../lib/paper/paperStyleResolve';

/** The two hosts: the export's inset and the share card's figure. */
export type ExportLayerOrderSurface = 'crease_export' | 'share_card';

export interface ExportLayerOrderRequestParts {
  readonly surface: ExportLayerOrderSurface;
  /** What the preview's fold was made from (`CreaseExportFoldResult.source`). */
  readonly source: LayerOrderSource;
  /** The scene the preview shows, so the dialog opens on the order shown (D19); null when there is none. */
  readonly shown: OristudioCpFoldedPaperScene | null;
  /** The sheet the creases lie on (`layerOrderRegionOfLines`); null when they lie on no one sheet. */
  readonly region: LayerOrderRegion | null;
  /** The order last applied to these creases this session, in the crease pattern's coordinates; null for none. */
  readonly record: LayerOrderRecord | null;
  /** The figure's style with the dialog's front and back colours pinned (`creaseExportPinnedStyle`). */
  readonly style: PaperStyle;
  readonly side: FoldedFigureSide;
  /** The figure's turn, clockwise on screen from its side, in degrees. */
  readonly turnDeg: number;
  /** Open with the hidden layers showing: when the figure is spread (D5; the spread work passes true). */
  readonly xray: boolean;
  /** Edit's view pen, which the crease-pattern pane draws in (D18). */
  readonly lineStyle: OristudioCpLineStyle;
  readonly lineWidth: number;
  /** What the dialog's title row calls the figure, and quieter after it, its credit. */
  readonly name: string;
  readonly byline?: string | null;
}

/**
 * The request for an export's or a share card's figure: its fold's own
 * source, never one re-derived from the document (approach 2); the order it
 * shows; the record last applied, so no constraint built this session is
 * lost on a reopen; and the look the inset is painted with — the flat
 * figure's policy, its side and turn, Edit's pen — so the dialog's panes are
 * the inset's.
 */
export function exportLayerOrderRequest(parts: ExportLayerOrderRequestParts): LayerOrderRequest {
  return {
    surface: parts.surface,
    source: parts.source,
    ...(parts.region ? { region: parts.region } : {}),
    record: parts.record,
    look: {
      style: parts.style,
      policy: PAPER_STYLE_POLICIES['folded-flat'],
      turnDeg: parts.turnDeg,
      side: parts.side === 'Back1' ? 'back' : 'front',
      xray: parts.xray,
      lineStyle: parts.lineStyle,
      lineWidth: parts.lineWidth,
    },
    ...(parts.shown ? { shown: parts.shown } : {}),
    name: parts.name,
    ...(parts.byline ? { byline: parts.byline } : {}),
  };
}
