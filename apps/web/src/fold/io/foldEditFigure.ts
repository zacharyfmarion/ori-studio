/**
 * "Start from Edit's folded figure" (plan D16): which of Edit's folded
 * figures a Fold sequence starts from, and its picture as the engine takes
 * it — the CP kernel's folded paper scene of the solution Edit shows.
 *
 * A figure qualifies when it is flat, folded and solved: a 3D figure has no
 * flat layer order, and one that found no solution has none to carry over.
 * The figure the user last worked on (Edit's active one) wins; otherwise the
 * newest that qualifies.
 */

import type { OristudioCpFoldedFigureEntry, OristudioCpFoldedPaperScene } from '../../engine/oristudioCpTypes';

export type FoldStartingFigureSource = {
  oristudioCpFoldedFigures: readonly OristudioCpFoldedFigureEntry[];
  oristudioCpActiveFoldedFigureId: string | null;
};

/** Whether a figure has a flat, solved layer order to start from. */
export function isFoldStartingFigure(
  figure: OristudioCpFoldedFigureEntry
): figure is OristudioCpFoldedFigureEntry & { handle: number } {
  return !figure.folded3d && figure.handle !== null && figure.snapshot?.outcome === 'Solved';
}

/** The figure a sequence starts from, or null when Edit has none. */
export function foldStartingFigure(state: FoldStartingFigureSource): (OristudioCpFoldedFigureEntry & { handle: number }) | null {
  const figures = state.oristudioCpFoldedFigures;
  const active = figures.find((figure) => figure.id === state.oristudioCpActiveFoldedFigureId);
  if (active && isFoldStartingFigure(active)) return active;
  for (let index = figures.length - 1; index >= 0; index -= 1) {
    const figure = figures[index];
    if (figure && isFoldStartingFigure(figure)) return figure;
  }
  return null;
}

/**
 * The starting figure's paper scene, read when the import runs, or null when
 * Edit has no figure to start from — or the kernel has nothing to draw for it.
 */
export async function foldStartingFigureScene(
  state: FoldStartingFigureSource,
  paperScene: (handle: number) => Promise<OristudioCpFoldedPaperScene | null>
): Promise<OristudioCpFoldedPaperScene | null> {
  const figure = foldStartingFigure(state);
  return figure ? paperScene(figure.handle) : null;
}
