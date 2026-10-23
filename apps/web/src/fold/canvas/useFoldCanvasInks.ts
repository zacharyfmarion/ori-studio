import { useMemo } from 'react';
import { readCssVarColor } from '../../cp-workspace/renderer/cssColor';
import type { Rgba } from '../../cp-workspace/renderer/types';
import type { FoldOverlayInks } from './foldPaneOverlays';

/** The theme colours the Fold canvas draws its tool feedback in, resolved against its element. */
export interface FoldCanvasInks {
  /** The moving set's tint, the picks and the hover. */
  accent: Rgba;
  /** A refused fold's faces. */
  danger: Rgba;
  overlay: FoldOverlayInks;
  /**
   * The canvas's ground, as `#rrggbb`: what a mark off the paper is inked
   * against. Hex, because the ground ink's contrast test (`wcagContrast`)
   * reads only hex, and an `rgb()` there reads as black.
   */
  ground: string;
}

const ACCENT_FALLBACK: Rgba = [0.33, 0.69, 0.64, 1];
const DANGER_FALLBACK: Rgba = [0.86, 0.33, 0.36, 1];
const GROUND_FALLBACK: Rgba = [0.07, 0.08, 0.09, 1];
/** One-dark's gold, as Edit's canvas falls back to, if the token somehow fails to resolve. */
const SELECTION_FALLBACK: Rgba = [0.898, 0.753, 0.482, 1];

const hex = ([r, g, b]: Rgba) =>
  `#${[r, g, b].map((c) => Math.round(Math.min(1, Math.max(0, c)) * 255).toString(16).padStart(2, '0')).join('')}`;

/**
 * The canvas's theme inks: the accent a theme gives what is picked and what
 * moves — drawn over the paper, never a paper colour (plan D11) — the danger
 * accent of a refused fold, and the ground. DOM-resolved, so read again when
 * `themeKey` changes; null until the canvas's element is there to read them.
 */
export function useFoldCanvasInks(element: Element | null, themeKey: string): FoldCanvasInks | null {
  return useMemo(() => {
    if (!element) return null;
    const accent = readCssVarColor(element, '--accent-primary', ACCENT_FALLBACK);
    const danger = readCssVarColor(element, '--status-danger', DANGER_FALLBACK);
    const ground = readCssVarColor(element, '--bg-primary', GROUND_FALLBACK);
    // Edit's selection colour, which a theme keeps clear of the fold colours (themes/applyTheme).
    const selection = readCssVarColor(element, '--cp-selection', SELECTION_FALLBACK);
    return {
      accent,
      danger,
      overlay: { accent, mark: accent, outline: ground, selection },
      ground: hex(ground),
    };
    // The theme is read off the element: its key is what says it changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [element, themeKey]);
}
