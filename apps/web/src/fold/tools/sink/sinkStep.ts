/**
 * The sinks' step (plan Phase 11, D6; research §5.4): from what the tools
 * picked and what the engine said of the point, to the op and choices a
 * document stores.
 *
 * - **The line, the side and the anchor** are a fold along a line's
 *   (`locateAlongLine`): the axiom's root, a free line, or an existing crease
 *   — sunk along, never unfolded along: a sink along its precrease is how one
 *   is usually folded. A sink's side is the tip's, the side with less paper;
 *   an unsink's the side the sunk point lies on, inside the paper round it,
 *   with more. Swap turns either round.
 * - **The point** is what the seed names: every layer on the side until the
 *   folder picks flaps. A sink takes one point, so a side of several is
 *   refused with a pick for each (the engine's `pick_flap`). An unsink whose
 *   folder named nothing names the one sunk point the engine found on its
 *   side (`sunkPoints`): every layer there is that point and the paper round
 *   it, which nothing would hold still.
 * - **The pocket**, when a closed sink's point has more than one, is one of
 *   the pockets the engine lists, stored by a sheet point either side of it
 *   (`pocketChoice`). A point with one pocket stores none, as the engine
 *   stores none.
 * - **The order**, when the completion leaves more than one, is one of the
 *   orders `sinkOrders` counts, each component's in turn, stored as the
 *   completion `sinkPick` gives for it.
 *
 * What a step stores is each one's result — sheet points, the completion's
 * FOLD triples — never an index (plan D6).
 *
 * Pure: no React, no store, no engine.
 */
import type {
  FoldChoices,
  FoldCompletionChoice,
  FoldSinkOp,
} from '../../document/foldSequenceDocument';
import type { FoldPickIndex } from '../../canvas/foldPicking';
import { pocketChoice, type FoldPocket, type FoldSinkOrders, type FoldStoredPocket } from '../../engine/foldEngineSinkWire';
import type { FoldFlap } from '../../engine/foldEngineWire';
import type { FoldSinkToolId } from '../foldToolCatalog';
import { locateAlongLine, type FoldLocateIntent, type FoldStepBuild } from '../foldStepBuilder';

/** The most layer orders the chooser steps through: every component's listed orders, together. */
export const MAX_SINK_ORDERS = 16;

/** What the tools have picked for a sink, and the choices made of what the engine lists. */
export interface FoldSinkIntent extends FoldLocateIntent {
  tool: FoldSinkToolId;
  /** A closed sink's pocket, when its point has several; null for one, or none, or another tool. */
  pocket: FoldStoredPocket | null;
  completion: FoldCompletionChoice | null;
  /** The sunk point an unsink names while the folder has named none; null until the engine has found it. */
  sunk: FoldFlap | null;
}

/** The sink step the intent describes, from the state `index` was made for; or why there is none yet. */
export function buildSinkStep(intent: FoldSinkIntent, index: FoldPickIndex): FoldStepBuild {
  const unsink = intent.tool === 'unsink';
  const located = locateAlongLine(intent, index, false, unsink ? 'more' : 'less');
  if ('status' in located) return located;
  const { line, choices: rooted, along, sceneLine, movingSign, acrossLayers } = located;
  // The sunk point's own sheet point says the side too: `moving` goes with every layer.
  const anchor =
    unsink && along.seed.scope === 'all' && intent.sunk
      ? { seed: { scope: 'flaps' as const, at: [intent.sunk.witness] } }
      : along;
  const op: FoldSinkOp = { kind: intent.tool, line, ...anchor };
  const choices: FoldChoices = {
    ...rooted,
    ...(intent.tool === 'closed-sink' && intent.pocket ? { pocket: pocketChoice(intent.pocket) } : {}),
    ...(intent.completion ? { completion: intent.completion } : {}),
  };
  return {
    status: 'built',
    op,
    ...(Object.keys(choices).length > 0 ? { choices } : {}),
    sceneLine,
    movingSign,
    via: line.via,
    scope: op.seed.scope,
    ...(acrossLayers ? { acrossLayers } : {}),
  };
}

/**
 * Every order the chooser steps through, as `sinkPick` takes one: a listed
 * order per component, the first component's stepping slowest, at most
 * {@link MAX_SINK_ORDERS}. Empty when the sink is decided.
 */
export function sinkOrderPicks(orders: FoldSinkOrders | null): number[][] {
  if (!orders || orders.components.length === 0) return [];
  let picks: number[][] = [[]];
  for (const component of orders.components) {
    const grown: number[][] = [];
    for (const pick of picks) {
      for (let k = 0; k < component.orders; k += 1) {
        if (grown.length >= MAX_SINK_ORDERS) break;
        grown.push([...pick, k]);
      }
    }
    picks = grown;
  }
  return picks.length > 1 ? picks : [];
}

/** A pocket as the window names it: in front of the other or behind it, as the viewer sees them, or by number. */
export type FoldPocketName = 'front' | 'back' | null;

/**
 * How many faces lie between a pocket and the viewer, who sees the model's
 * top unless the view is turned over (`flipped`).
 */
function facesInFront(pocket: FoldPocket, flipped: boolean): number {
  return flipped ? pocket.lower.length : pocket.upper.length;
}

/**
 * Each pocket's name: of two, the one with fewer faces between it and the
 * viewer is the front pocket and the other the back. Of any other number,
 * or two the viewer sees no nearer, they are numbered (null).
 */
export function pocketNames(pockets: readonly FoldPocket[], flipped: boolean): FoldPocketName[] {
  const inFront = (pocket: FoldPocket) => facesInFront(pocket, flipped);
  const [a, b] = pockets;
  if (pockets.length !== 2 || !a || !b || inFront(a) === inFront(b)) return pockets.map(() => null);
  return inFront(a) < inFront(b) ? ['front', 'back'] : ['back', 'front'];
}

/**
 * The pockets in the order the chooser steps through them: front to back as
 * the viewer sees them, so a closed sink starts on the front pocket; the
 * engine's order where the viewer sees two no nearer. What a step stores is
 * the pocket's own sheet points, never its place here.
 */
export function pocketsAsSeen(pockets: readonly FoldPocket[], flipped: boolean): FoldPocket[] {
  return [...pockets].sort((a, b) => facesInFront(a, flipped) - facesInFront(b, flipped));
}
