import { useEffect, useRef, useState } from 'react';
import type { CreaseExportFoldedFigureSettings } from '../../lib/creaseExport';
import type {
  CpModelToFoldTransform,
  CreaseExportFoldResult,
  CreaseExportOrderedFold,
} from '../../lib/creaseExportFold';
import type { LayerOrderApplied, LayerOrderSource } from '../../lib/layerOrder/layerOrderRequest';
import type {
  OristudioCpFoldedPaperScene,
  OristudioCpFoldedRenderSnapshot,
} from '../../engine/oristudioCpTypes';

/**
 * A layer order chosen for a figure's creases in the Layer order dialog: what
 * folds the figure in it (its record, its relations, the source they name
 * faces on), and the key its picture is cached by.
 */
export interface FoldedFigureOrder {
  readonly applied: LayerOrderApplied;
  readonly key: string;
}

export interface FoldedFigurePreview {
  /** The folded snapshot to draw, or null when folding is off, pending, or failed. */
  figure: OristudioCpFoldedRenderSnapshot | null;
  /**
   * The same fold as the kernel's paper scene, which the card paints through
   * the shared painter; null with `figure`, or when the kernel had no paper
   * picture for the fold and the snapshot is what there is to draw.
   */
  scene: OristudioCpFoldedPaperScene | null;
  /** Places the figure's kernel coordinates in the document's fold space. */
  transform: CpModelToFoldTransform | undefined;
  /** Layer-ordering solutions the kernel found, for a "case N of M" readout. */
  discoveredCases: number;
  /** The solution shown, 1-based, and whether the search may find another (`layerOrderCount`). */
  currentCase: number;
  hasNext: boolean;
  /**
   * Whether the fold put its layers in order (D3): false for the see-through
   * development of one that could not; null until a fold has landed.
   */
  ordered: boolean | null;
  /**
   * What the fold was made from, for the Layer order dialog: the source of
   * the last fold that landed, which is a chosen order's too.
   */
  source: LayerOrderSource | null;
  /** The chosen layer order the figure is drawn in, or null for the kernel's own. */
  order: FoldedFigureOrder | null;
  /**
   * The kernel would not draw the chosen order: the figure kept the picture
   * it had (or, on a first fold, shows the kernel's own order).
   */
  orderRefused: boolean;
  folding: boolean;
  /** Kernel message when the fold failed, verbatim — it is the useful part. */
  error: string | null;
  clearError: () => void;
}

export interface FoldedFigurePreviewOptions {
  enabled: boolean;
  settings: CreaseExportFoldedFigureSettings;
  /**
   * Runs the fold. Injected rather than imported so callers stay free of the kernel
   * runtime. Null when this surface cannot fold at all (no editable document).
   */
  fold: ((settings: CreaseExportFoldedFigureSettings) => Promise<CreaseExportFoldResult>) | null;
  /**
   * Folds in a chosen layer order (`foldSegmentInOrderForExport`), injected as `fold`
   * is. Without it every fold is in the kernel's own order.
   */
  foldInOrder?:
    | ((settings: CreaseExportFoldedFigureSettings, order: LayerOrderApplied) => Promise<CreaseExportOrderedFold>)
    | null;
  /**
   * The layer order chosen for a fold of these creases, by the digest of what it was
   * made from, or null for none (`exportLayerOrders.ts`): asked as each fold lands, so a
   * figure folded again opens on its chosen order rather than flashing the kernel's.
   */
  orderFor?: (digest: string) => FoldedFigureOrder | null;
  /** Extra cache-key input, for callers whose fold depends on more than `settings`. */
  cacheKeyPrefix?: string;
  /** Called when a fold fails, so the caller can untick its own toggle. */
  onError?: (message: string) => void;
}

/**
 * Fold a crease pattern for a preview, with caching and cancellation.
 *
 * The one fold behind both the crease-pattern export dialog (`CreaseExportDialog`) and
 * the share modal, so the two behave identically rather than as two subtly different
 * copies. This is state and effect management, not presentation — the two dialogs'
 * *controls* differ, which is why only this part is shared.
 *
 * The document cannot change while a modal is open, so a pattern folded with the same
 * settings is reused instead of refolded — folding is the expensive step, and a colour
 * change would otherwise pay for it twice.
 *
 * **A chosen layer order.** Once the creases have an order chosen for them (`orderFor`,
 * by the fold's source digest), the figure is folded in it (`foldInOrder`) at every
 * side and colour, and cached under the order's key too; with none, the fold is the
 * kernel's own at `foldCase`, exactly as before. The kernel refusing the order keeps the
 * picture there was and says so (`orderRefused`).
 */
export function useFoldedFigurePreview({
  enabled,
  settings,
  fold,
  foldInOrder = null,
  orderFor,
  cacheKeyPrefix = '',
  onError,
}: FoldedFigurePreviewOptions): FoldedFigurePreview {
  const [figure, setFigure] = useState<OristudioCpFoldedRenderSnapshot | null>(null);
  const [scene, setScene] = useState<OristudioCpFoldedPaperScene | null>(null);
  const [transform, setTransform] = useState<CpModelToFoldTransform | undefined>(undefined);
  const [discoveredCases, setDiscoveredCases] = useState(1);
  const [place, setPlace] = useState<{ currentCase: number; hasNext: boolean; ordered: boolean | null }>({
    currentCase: 1,
    hasNext: false,
    ordered: null,
  });
  const [source, setSource] = useState<LayerOrderSource | null>(null);
  const [orderRefused, setOrderRefused] = useState(false);
  const [folding, setFolding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cache = useRef(new Map<string, CreaseExportFoldResult>());
  // Held in a ref so a caller passing an inline arrow does not re-run the fold, and
  // written in an effect rather than during render — a ref mutated mid-render is exactly
  // the pattern that makes a component miss an update.
  const onErrorRef = useRef(onError);
  const orderForRef = useRef(orderFor);
  useEffect(() => {
    onErrorRef.current = onError;
    orderForRef.current = orderFor;
  }, [onError, orderFor]);

  // The order chosen for the creases the last fold was made from: every fold of them
  // after this one is in it.
  const order = source && orderFor && foldInOrder ? orderFor(source.digest) : null;
  const orderKey = order?.key ?? '';

  useEffect(() => {
    if (!enabled || !fold) {
      setFigure(null);
      setScene(null);
      setFolding(false);
      return undefined;
    }

    const plainKey = `${cacheKeyPrefix}:${settings.side}:${settings.frontColor}:${settings.backColor}:${settings.foldCase}`;
    const keyOf = (chosen: FoldedFigureOrder | null) => (chosen ? `${plainKey}:${chosen.key}` : plainKey);
    const publish = (result: CreaseExportFoldResult) => {
      setFigure(result.snapshot);
      setScene(result.scene);
      setDiscoveredCases(result.discoveredCases);
      setTransform(result.transform);
      setPlace({
        currentCase: result.currentCase ?? settings.foldCase,
        hasNext: result.hasNext ?? false,
        // A runtime that does not say: a chosen order, or a paper scene, is an order.
        ordered: result.ordered ?? (result.chosenOrder === true || result.scene !== null),
      });
      if (result.source) setSource(result.source);
    };
    const cached = cache.current.get(keyOf(order));
    if (cached) {
      publish(cached);
      setOrderRefused(false);
      setError(null);
      return undefined;
    }

    let cancelled = false;
    setFolding(true);
    setError(null);
    /** The figure in `chosen`, cached under its key; null when the kernel refuses it. */
    const inOrder = async (chosen: FoldedFigureOrder): Promise<CreaseExportFoldResult | null> => {
      if (!foldInOrder) return null;
      const folded = await foldInOrder(settings, chosen.applied);
      if (folded.status === 'refused') return null;
      cache.current.set(keyOf(chosen), folded.result);
      return folded.result;
    };
    const run = async (): Promise<{ result: CreaseExportFoldResult | null; refused: boolean }> => {
      if (order) {
        const result = await inOrder(order);
        return { result, refused: result === null };
      }
      const plain = await fold(settings);
      // Cache even if this render was torn down first: the next mount picks it up.
      cache.current.set(plainKey, plain);
      // These creases have an order chosen for them (another dialog chose it, earlier
      // in the session): shown in it from the start, not after a flash of the kernel's.
      const remembered = plain.source && foldInOrder ? (orderForRef.current?.(plain.source.digest) ?? null) : null;
      if (!remembered) return { result: plain, refused: false };
      const result = await inOrder(remembered);
      return result ? { result, refused: false } : { result: plain, refused: true };
    };
    void run()
      .then(({ result, refused }) => {
        if (cancelled) return;
        setOrderRefused(refused);
        // A refused order keeps the picture there was: nothing to publish.
        if (result) publish(result);
      })
      .catch((failure: unknown) => {
        if (cancelled) return;
        // The preview is the contract: rather than publish something the preview never
        // showed, drop the figure and say why.
        const message = failure instanceof Error ? failure.message : String(failure);
        setFigure(null);
        setScene(null);
        setError(message);
        onErrorRef.current?.(message);
      })
      .finally(() => {
        if (!cancelled) setFolding(false);
      });

    return () => {
      cancelled = true;
    };
    // `order` is read through its key: the order object is the store's, and changes only with it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, fold, foldInOrder, cacheKeyPrefix, settings, orderKey]);

  return {
    figure,
    scene,
    transform,
    discoveredCases,
    currentCase: place.currentCase,
    hasNext: place.hasNext,
    ordered: place.ordered,
    source,
    order,
    orderRefused,
    folding,
    error,
    clearError: () => setError(null),
  };
}
