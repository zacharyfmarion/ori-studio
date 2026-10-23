/**
 * A folded state drawn small, for a card: the step strip's (plan D14) and
 * Import CP's layer orders' (D16), each the state it stands for.
 *
 * The folded pane's own picture, made small: the pane's scene
 * (`foldedPaneScene`, so the toolbar's Precreases switch reaches the cards,
 * and so does a step's layer spread, `foldStepSpread`) painted by the
 * shared painter in the user's paper style, read through the pane's policy
 * (`fold`): the paper in its two colours, front and back, every fold an edge,
 * a precrease in the aux pen. The page is transparent, fitted to the figure,
 * and drops what nothing shows: a card is what the reader would see.
 *
 * Pure: no React, no store.
 */

import type { LayerSpreadOptions } from '../../cp-workspace/folded/foldedLayerSpread';
import type { PaperStyle } from '../../lib/paper/paperStyle';
import { PAPER_STYLE_POLICIES, surfacePaperStyle } from '../../lib/paper/paperStyleResolve';
import { paperSceneToSvg } from '../../lib/paper/paperSvg';
import type { FoldScene } from '../engine/foldEngineWire';
import { FOLD_PANE_DISPLAY_DEFAULT, foldedPaneScene, type FoldPaneDisplay } from './foldPaneScenes';

/**
 * The page: the figure a few mm across, with a hairline of room for the pens,
 * which keep their pt widths as on every page — at a card's size, about the
 * hairline the pane draws at its fit.
 */
const CARD_PAGE = { sheet: { mm: 30 }, paddingMm: 0.5, background: null, keepHiddenFaces: false } as const;

/** The style as the pane reads it, keyed by the style it was read from. */
const surfaced = new WeakMap<PaperStyle, { style: PaperStyle; key: string }>();

function paneStyle(style: PaperStyle): { style: PaperStyle; key: string } {
  let read = surfaced.get(style);
  if (!read) {
    const seen = surfacePaperStyle(style, PAPER_STYLE_POLICIES.fold);
    read = { style: seen, key: JSON.stringify(seen) };
    surfaced.set(style, read);
  }
  return read;
}

/**
 * The look every picture shares: the style as the pane reads it, and the
 * display switches the pane's scene reads. Two pictures of one state, with
 * one spread ({@link foldSpreadPictureKey}), under the same look are the same
 * picture, so a cache keys by the state, the spread and this; a change of
 * look repaints every card, a change of spread only the cards it reaches.
 */
export function foldStatePictureKey(style: PaperStyle, display: FoldPaneDisplay = FOLD_PANE_DISPLAY_DEFAULT): string {
  return `${display.precreases ? 'precreases' : 'bare'}|${paneStyle(style).key}`;
}

/** What a picture's layer spread adds to its key: none, or the spread itself. */
export function foldSpreadPictureKey(spread: LayerSpreadOptions | null): string {
  return spread ? JSON.stringify(spread) : 'flat';
}

/** The state as an SVG data URL, its layers spread by `spread` (none for null), or null when it has nothing to draw. */
export function foldStatePictureUrl(
  scene: FoldScene,
  style: PaperStyle,
  display: FoldPaneDisplay = FOLD_PANE_DISPLAY_DEFAULT,
  spread: LayerSpreadOptions | null = null
): string | null {
  // The pane's scene: where the pane is shown makes no difference to a picture fitted to its figure.
  const paper = foldedPaneScene(scene, display, undefined, spread);
  if (paper.items.length === 0) return null;
  const { svg } = paperSceneToSvg(paper, paneStyle(style).style, CARD_PAGE, 'figure');
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
