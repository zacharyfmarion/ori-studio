import { useEffect, useRef, useState } from 'react';
import type { CreaseExportFoldedFigureSettings } from '../../lib/creaseExport';
import type { CpModelToFoldTransform, CreaseExportFoldResult } from '../../lib/creaseExportFold';
import type { OristudioCpFoldedRenderSnapshot } from '../../engine/oristudioCpTypes';

export interface FoldedFigurePreview {
  /** The folded snapshot to draw, or null when folding is off, pending, or failed. */
  figure: OristudioCpFoldedRenderSnapshot | null;
  /** Places the figure's kernel coordinates in the document's fold space. */
  transform: CpModelToFoldTransform | undefined;
  /** Layer-ordering solutions the kernel found, for a "case N of M" readout. */
  discoveredCases: number;
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
  /** Extra cache-key input, for callers whose fold depends on more than `settings`. */
  cacheKeyPrefix?: string;
  /** Called when a fold fails, so the caller can untick its own toggle. */
  onError?: (message: string) => void;
}

/**
 * Fold a crease pattern for a preview, with caching and cancellation.
 *
 * Extracted from `CreaseExportDialog` so the share modal gets identical behaviour rather
 * than a second, subtly different copy. This is state and effect management, not
 * presentation — the two dialogs' *controls* differ (the share modal offers front/back
 * only, and no fold case), which is why only this part is shared.
 *
 * The document cannot change while a modal is open, so a pattern folded with the same
 * settings is reused instead of refolded — folding is the expensive step, and a colour
 * change would otherwise pay for it twice.
 */
export function useFoldedFigurePreview({
  enabled,
  settings,
  fold,
  cacheKeyPrefix = '',
  onError,
}: FoldedFigurePreviewOptions): FoldedFigurePreview {
  const [figure, setFigure] = useState<OristudioCpFoldedRenderSnapshot | null>(null);
  const [transform, setTransform] = useState<CpModelToFoldTransform | undefined>(undefined);
  const [discoveredCases, setDiscoveredCases] = useState(1);
  const [folding, setFolding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cache = useRef(new Map<string, CreaseExportFoldResult>());
  // Held in a ref so a caller passing an inline arrow does not re-run the fold, and
  // written in an effect rather than during render — a ref mutated mid-render is exactly
  // the pattern that makes a component miss an update.
  const onErrorRef = useRef(onError);
  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  useEffect(() => {
    if (!enabled || !fold) {
      setFigure(null);
      setFolding(false);
      return undefined;
    }

    const key = `${cacheKeyPrefix}:${settings.side}:${settings.frontColor}:${settings.backColor}:${settings.foldCase}`;
    const cached = cache.current.get(key);
    if (cached) {
      setFigure(cached.snapshot);
      setDiscoveredCases(cached.discoveredCases);
      setTransform(cached.transform);
      setError(null);
      return undefined;
    }

    let cancelled = false;
    setFolding(true);
    setError(null);
    void fold(settings)
      .then((result) => {
        // Cache even if this render was torn down first: the next mount picks it up.
        cache.current.set(key, result);
        if (cancelled) return;
        setFigure(result.snapshot);
        setDiscoveredCases(result.discoveredCases);
        setTransform(result.transform);
      })
      .catch((failure: unknown) => {
        if (cancelled) return;
        // The preview is the contract: rather than publish something the preview never
        // showed, drop the figure and say why.
        const message = failure instanceof Error ? failure.message : String(failure);
        setFigure(null);
        setError(message);
        onErrorRef.current?.(message);
      })
      .finally(() => {
        if (!cancelled) setFolding(false);
      });

    return () => {
      cancelled = true;
    };
  }, [enabled, fold, cacheKeyPrefix, settings]);

  return {
    figure,
    transform,
    discoveredCases,
    folding,
    error,
    clearError: () => setError(null),
  };
}
