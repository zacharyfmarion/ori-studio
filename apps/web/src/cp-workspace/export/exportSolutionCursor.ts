/**
 * ‹ › through the solutions that fit a layer order chosen in the Export crease
 * pattern dialog or the Share modal: the hosts' one cursor
 * (`layer-order/host/solutionCursorTable.ts`, rows H6 and H9), bound to an
 * export's figure as Edit binds it to a figure (`foldedSolutionCursor.ts`)
 * and the Diagram to a step.
 *
 * - **The thing it steps** is the figure's creases, by the digest of what the
 *   fold was made from, in the order chosen for them (its key): whenever the
 *   order the export keeps for them is another, the cursor is out of step and
 *   the next press makes a fresh one from the order kept then.
 * - **Made on the first press, never before**, and kept only while it is
 *   used, as every host's is: a Layer order dialog opening, a minute with no
 *   press, another host's cursor, or the export dialog closing lets it go.
 * - **The document cannot change** while an export dialog is open, so what
 *   the figure was folded from always holds.
 *
 * Store-free and React-free; `useExportLayerOrder` binds it.
 */
import type { LayerStepBy } from '../../layer-order/engine/layerOrderEngine';
import type { LayerOrderSolutionStep } from '../../layer-order/host/hostEngineGateway';
import {
  createSolutionCursorTable,
  type SolutionCursorOpening,
  type SolutionPlace,
} from '../../layer-order/host/solutionCursorTable';
import type { LayerOrderApplied } from '../../lib/layerOrder/layerOrderRequest';

/** An export's figure, as its pager steps it. */
export interface ExportCursorFigure {
  /** The digest of what the figure's fold was made from: which creases these are. */
  readonly digest: string;
  /** The key of the order chosen for them, as the export keeps it now. */
  readonly orderKey: string;
  /** The side the figure shows, whose distinct pictures the stepper walks (D5)... */
  readonly side: 'front' | 'back';
  /** ...or every layer order, when the figure shows its hidden layers. */
  readonly xray: boolean;
}

interface ExportCursorMark {
  readonly orderKey: string;
}

const table = createSolutionCursorTable<ExportCursorFigure, null, ExportCursorMark, SolutionCursorOpening>({
  idOf: (figure) => figure.digest,
  markOf: (figure) => ({ orderKey: figure.orderKey }),
  inStep: (mark, figure) => mark.orderKey === figure.orderKey,
  heldIn: () => true,
  stepBy: exportFigureStepBy,
});

/** What an export's stepper steps through (D5): every layer order in X-ray, else the pictures of its side. */
export function exportFigureStepBy(figure: ExportCursorFigure): LayerStepBy {
  return figure.xray ? 'layer_order' : { picture: figure.side };
}

/**
 * Where the order `figure` shows lies among the solutions that fit it, once
 * a press has asked; null before then, as every host reads at rest (D11).
 */
export function exportSolutionPlace(figure: ExportCursorFigure): SolutionPlace | null {
  return table.place(figure);
}

/**
 * One press of ‹ or › on `figure`: steps the cursor (making it from `open`
 * when none is in step), and on a step that moved, hands the order it landed
 * on to `land`, which keeps it for the figure under its new key. Answers the
 * step, however it ended; only `moved` changed anything.
 */
export async function stepExportSolution(
  figure: ExportCursorFigure,
  direction: 'next' | 'previous',
  open: () => Promise<SolutionCursorOpening>,
  land: (applied: LayerOrderApplied) => string | null
): Promise<LayerOrderSolutionStep> {
  const turn = table.begin(figure, null);
  let now = figure;
  try {
    const answer = await turn.step({ direction, open });
    if (answer.outcome === 'moved') {
      const orderKey = land(answer.applied);
      if (orderKey !== null) {
        turn.landed(() => ({ orderKey }));
        now = { ...figure, orderKey };
      }
    }
    return answer;
  } finally {
    turn.end((id) => (id === now.digest ? now : undefined), null);
  }
}

/** Close the cursor, with its worker, if one is kept. Idempotent. */
export function dropExportSolutionCursor(): void {
  table.drop();
}

/** For `useSyncExternalStore`: called whenever what {@link exportSolutionPlace} answers may have changed. */
export function subscribeExportSolutionCursor(listener: () => void): () => void {
  return table.subscribe(listener);
}

/** For `useSyncExternalStore`: moves whenever the table does. */
export function exportSolutionCursorVersion(): number {
  return table.version();
}
