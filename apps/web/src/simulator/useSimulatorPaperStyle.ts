import type { PaperStyleEditSource } from '../analytics';
import {
  usePaperDisplayStyle,
  type PaperDisplayRow,
  type PaperDisplayStyleBinding,
} from '../lib/paper/usePaperDisplayStyle';

/**
 * The fields the Simulate pane's Paper and Creases rows edit, and so the ones
 * its reset touches. The simulator policy applies more — the aux pen, its
 * toggle and erode joined it in Phase 5 — but those rows are Settings ▸
 * Paper's; a reset here leaves them where the user put them. So are the
 * pens' widths, dashes and caps: the pane edits a pen's colour only.
 */
export const SIMULATOR_PANE_FIELDS: readonly PaperDisplayRow[] = [
  'paper.front',
  'paper.back',
  'edges',
  'mountainFolds',
  'valleyFolds',
  'foldsAsEdges',
  'light',
];

/** Which of the simulator's surfaces a binding edits from, as `paper style changed` names it. */
export type SimulatorPaperStyleSource = Extract<
  PaperStyleEditSource,
  'simulator-view-controls' | 'simulator'
>;

/**
 * The simulator's rows of the display style: the Simulate options pane's
 * Paper and Creases sections and the Simulate viewport's lighting verb bind
 * the same rows, told apart only by the `source` they count under.
 */
export function useSimulatorPaperStyle(source: SimulatorPaperStyleSource): PaperDisplayStyleBinding {
  return usePaperDisplayStyle(source, SIMULATOR_PANE_FIELDS);
}
