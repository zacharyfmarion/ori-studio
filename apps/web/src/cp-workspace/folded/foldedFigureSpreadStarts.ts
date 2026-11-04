/**
 * What an Edit figure's spread starts from (decision 1 of
 * `implementation-plans/spread-and-layer-order-in-edit-export-share.md`):
 * turned on, the spread most recently set on another figure in the
 * document, else the default (`DEFAULT_CONNECTED_SPREAD`); switched to a
 * kind, the most recent of that kind, else that kind's default. The shared
 * start rule (`spreadStartsAmong`) walks them, as a Diagram step's and a Fold
 * step's walk the pictures before theirs.
 *
 * Edit's figures have no order of their own to walk, so "most recent" is
 * this session's: each figure whose spread is set is noted here
 * ({@link noteFoldedFigureSpreadSet}). Figures not set this session — a
 * reopened file's — follow, the last folded first.
 *
 * React-free and store-free; the recency is the one piece of module state.
 */
import type { OristudioCpFoldedFigureEntry } from '../../engine/oristudioCpTypes';
import { foldedFigureSpreadOptions } from './foldedFigureSpread';
import type { LayerSpreadOptions } from './foldedLayerSpread';
import { spreadStartsAmong, type LayerSpreadStarts } from './layerSpreadSettings';

/** How many recently set figures are remembered: far more than a canvas holds at once. */
const REMEMBERED = 64;

/** Figure ids, the spread most recently set first. */
let recentlySet: readonly string[] = [];

/** A figure's spread was set — turned on, switched or moved — just now. */
export function noteFoldedFigureSpreadSet(id: string): void {
  if (recentlySet[0] === id) return;
  recentlySet = [id, ...recentlySet.filter((each) => each !== id)].slice(0, REMEMBERED);
}

/** Forget what was set. For tests; nothing in the app resets it. */
export function resetFoldedFigureSpreadRecency(): void {
  recentlySet = [];
}

/**
 * The starts for the figure `id`: from every other figure's spread this
 * build reads, the most recently set first, then the rest, the last in the
 * list first.
 */
export function foldedFigureSpreadStarts(
  figures: readonly OristudioCpFoldedFigureEntry[],
  id: string,
  recent: readonly string[] = recentlySet
): LayerSpreadStarts {
  const others = figures.filter((figure) => figure.id !== id);
  const byId = new Map(others.map((figure) => [figure.id, figure]));
  const remembered = new Set(recent);
  const ordered = [
    ...recent.flatMap((each) => byId.get(each) ?? []),
    ...[...others].reverse().filter((figure) => !remembered.has(figure.id)),
  ];
  return spreadStartsAmong(
    ordered.flatMap((figure): LayerSpreadOptions[] => {
      const spread = foldedFigureSpreadOptions(figure);
      return spread ? [spread] : [];
    })
  );
}
