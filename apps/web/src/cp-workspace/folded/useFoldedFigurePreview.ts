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
   * the last fold of this pattern (`cacheKeyPrefix`) that landed, which is a
   * chosen order's too; null until one has.
   */
  source: LayerOrderSource | null;
  /**
   * What the figure on show was folded from: `source` once this pattern's fold
   * has landed, and until then the figure's it replaces, which stays on show,
   * dimmed, in its own turn. Null with `figure`.
   */
  figureSource: LayerOrderSource | null;
  /** The chosen layer order the figure is drawn in, or null for the kernel's own. */
  order: FoldedFigureOrder | null;
  /**
   * The kernel would not draw the chosen order: the figure kept the picture
   * it had (or, with none on show, shows the kernel's own order).
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
  /**
   * Extra cache-key input, for callers whose fold depends on more than `settings`: the
   * pattern folded. Each keeps the source its folds landed with, and so its own order.
   */
  cacheKeyPrefix?: string;
  /** Called when a fold fails, so the caller can untick its own toggle. */
  onError?: (message: string) => void;
}

/** A fold in the preview's cache, with the colours it was folded in. */
interface CachedFold {
  readonly result: CreaseExportFoldResult;
  readonly colours: string;
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
 * settings is reused instead of refolded — folding is the expensive step.
 *
 * **Keyed by geometry.** A fold is cached by what shapes it — the pattern, the side, the
 * case and the layer order — not by its colours: the paper scene carries no colour, and
 * the page pins the dialog's colours over it as it paints (`creaseExportPaperStyle`), so a
 * colour edit repaints the figure rather than folding it again, or solving its spread
 * again. Only a fold with no paper scene — the kernel's see-through development, whose
 * drawing has its colours in it — is folded again in new colours. A fold still running
 * when a colour changes is waited for, not started again.
 *
 * **A chosen layer order.** Once the creases have an order chosen for them (`orderFor`,
 * by the source digest of the pattern's last fold, which each `cacheKeyPrefix` keeps for
 * itself), the figure is folded in it (`foldInOrder`) at every side, and cached under
 * the order's key too; with none, the fold is the kernel's own at `foldCase`, exactly as
 * before. The kernel refusing the order keeps the picture there was at these settings, or
 * with none shows the kernel's own order, and says so (`orderRefused`).
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
  // What each pattern's last fold that landed was made from, by its cache prefix.
  const [sources, setSources] = useState<Readonly<Record<string, LayerOrderSource>>>({});
  const [figureSource, setFigureSource] = useState<LayerOrderSource | null>(null);
  const [orderRefused, setOrderRefused] = useState(false);
  const [folding, setFolding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cache = useRef(new Map<string, CachedFold>());
  // Folds still running, by their key: a colour edit while one runs waits for it.
  const running = useRef(new Map<string, Promise<CachedFold | null>>());
  // The fold the preview shows, and the pattern, side and case it was folded at: a
  // cache hit already on show sets nothing, and a refused order keeps it at those.
  const published = useRef<{ readonly result: CreaseExportFoldResult; readonly at: string } | null>(null);
  // Held in a ref so a caller passing an inline arrow does not re-run the fold, and
  // written in an effect rather than during render — a ref mutated mid-render is exactly
  // the pattern that makes a component miss an update. Declared before the fold's effect,
  // so it is current when that runs.
  const onErrorRef = useRef(onError);
  const orderForRef = useRef(orderFor);
  const settingsRef = useRef(settings);
  useEffect(() => {
    onErrorRef.current = onError;
    orderForRef.current = orderFor;
    settingsRef.current = settings;
  }, [onError, orderFor, settings]);

  // The order chosen for the creases this pattern's last fold was made from: every fold
  // of them after that one is in it.
  const source = sources[cacheKeyPrefix] ?? null;
  const order = source && orderFor && foldInOrder ? orderFor(source.digest) : null;
  const orderKey = order?.key ?? '';
  const { side, foldCase } = settings;
  const colours = `${settings.frontColor}:${settings.backColor}`;

  useEffect(() => {
    if (!enabled || !fold) {
      published.current = null;
      setFigure(null);
      setScene(null);
      setFigureSource(null);
      setFolding(false);
      return undefined;
    }

    const current = settingsRef.current;
    const plainKey = `${cacheKeyPrefix}:${side}:${foldCase}`;
    const keyOf = (chosen: FoldedFigureOrder | null) => (chosen ? `${plainKey}:${chosen.key}` : plainKey);
    // A paper scene is drawn in whatever colours the page pins; a drawing has its own.
    const fits = (entry: CachedFold | null | undefined): entry is CachedFold =>
      entry != null && (entry.result.scene !== null || entry.colours === colours);
    const publish = (result: CreaseExportFoldResult) => {
      if (published.current?.result === result) return;
      published.current = { result, at: plainKey };
      setFigure(result.snapshot);
      setScene(result.scene);
      setFigureSource(result.source ?? null);
      setDiscoveredCases(result.discoveredCases);
      setTransform(result.transform);
      setPlace({
        currentCase: result.currentCase ?? foldCase,
        hasNext: result.hasNext ?? false,
        // A runtime that does not say: a chosen order, or a paper scene, is an order.
        ordered: result.ordered ?? (result.chosenOrder === true || result.scene !== null),
      });
      const landed = result.source;
      if (landed) setSources((all) => (all[cacheKeyPrefix] === landed ? all : { ...all, [cacheKeyPrefix]: landed }));
    };
    const cached = cache.current.get(keyOf(order));
    if (fits(cached)) {
      publish(cached.result);
      setOrderRefused(false);
      // A fold still running is a replaced run's, which never says it is done.
      setFolding(false);
      setError(null);
      return undefined;
    }

    let cancelled = false;
    setFolding(true);
    setError(null);
    /**
     * The fold under `key`, in the colours asked: the one cached, the one running if it
     * is still running, else a new one. Cached even if this render was torn down
     * first: the next run picks it up. Null for an order the kernel refused.
     */
    const folded = async (key: string, make: () => Promise<CreaseExportFoldResult | null>): Promise<CachedFold | null> => {
      const kept = cache.current.get(key);
      if (fits(kept)) return kept;
      const pending = running.current.get(key);
      const ran = pending ? await pending : null;
      if (fits(ran)) return ran;
      if (pending && ran === null) return null;
      const started = make().then((result) => {
        if (!result) return null;
        const entry = { result, colours };
        cache.current.set(key, entry);
        return entry;
      });
      running.current.set(key, started);
      try {
        return await started;
      } finally {
        if (running.current.get(key) === started) running.current.delete(key);
      }
    };
    /** The figure in `chosen`, cached under its key; null when the kernel refuses it. */
    const inOrder = async (chosen: FoldedFigureOrder): Promise<CreaseExportFoldResult | null> => {
      if (!foldInOrder) return null;
      const entry = await folded(keyOf(chosen), async () => {
        const result = await foldInOrder(current, chosen.applied);
        return result.status === 'refused' ? null : result.result;
      });
      return entry?.result ?? null;
    };
    const run = async (): Promise<{ result: CreaseExportFoldResult | null; refused: boolean }> => {
      if (order) {
        const result = await inOrder(order);
        if (result) return { result, refused: false };
        // Refused: the picture on show stays if it is of this pattern at this side and
        // case; with none (another pattern's, or another side's, may be on show), the
        // figure is the kernel's own order.
        if (published.current?.at === plainKey) return { result: null, refused: true };
        const plainFold = await folded(plainKey, () => fold(current));
        return { result: plainFold?.result ?? null, refused: true };
      }
      const plainFold = await folded(plainKey, () => fold(current));
      // The kernel's own order is never refused; a fold that fails throws.
      if (!plainFold) return { result: null, refused: false };
      const plain = plainFold.result;
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
        published.current = null;
        setFigure(null);
        setScene(null);
        setFigureSource(null);
        setError(message);
        onErrorRef.current?.(message);
      })
      .finally(() => {
        if (!cancelled) setFolding(false);
      });

    return () => {
      cancelled = true;
    };
    // `order` is read through its key: the order object is the store's, and changes only
    // with it. The settings are read through theirs: the side, the case and the colours.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, fold, foldInOrder, cacheKeyPrefix, side, foldCase, colours, orderKey]);

  return {
    figure,
    scene,
    transform,
    discoveredCases,
    currentCase: place.currentCase,
    hasNext: place.hasNext,
    ordered: place.ordered,
    source,
    figureSource,
    order,
    orderRefused,
    folding,
    error,
    clearError: () => setError(null),
  };
}
