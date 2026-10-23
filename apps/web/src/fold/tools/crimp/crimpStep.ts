/**
 * The crimp's step (plan Phase 11, research §5.2): from what the tools picked
 * and what the engine said of the tip, to the op and choices a document
 * stores.
 *
 * - **The first line, the tip side and the anchor** are a reverse fold's
 *   (`locateAlongLine`): ℓ1 nearer the body, located in any line mode — its
 *   axiom's root the step's one root — the moving side the tip's, the seed
 *   what the tip grows from.
 * - **The second line**, ℓ2 nearer the tip, is located after the first, by
 *   the clicks past ℓ1's (`locateSecondLine`): a free line or an existing
 *   crease, never an axiom, since a step stores one root.
 * - **The kind**, the same on both lines (inside or outside: a mixed pair is
 *   two reverse folds), is the folder's when it lands, else the only one
 *   that does, else inside — the reverse fold's rule (`reverseKindToFold`).
 * - **The openings and the order** are a reverse fold's: one opening per
 *   flap that opens several ways, and the completion that picks an order,
 *   each stored as its result (plan D6).
 *
 * Pure: no React, no store, no engine.
 */
import type {
  FoldChoices,
  FoldCompletionChoice,
  FoldCrimpKind,
  FoldCrimpOp,
  FoldModelLine,
  FoldOpeningChoice,
} from '../../document/foldSequenceDocument';
import type { FoldPickIndex } from '../../canvas/foldPicking';
import type { FoldSecondLineModeId } from '../foldToolCatalog';
import { lineModeInput } from '../foldToolRegistry';
import {
  lineAcrossPaper,
  locateAlongLine,
  locateSecondLine,
  type FoldLocateIntent,
  type FoldStepBuild,
} from '../foldStepBuilder';
import type { Point } from '../../../lib/geometry';

/** What the tools have picked for a crimp, and the choices made of what the engine lists. */
export interface FoldCrimpIntent extends FoldLocateIntent {
  /** How the second line is located: its clicks are the ones past the first line's. */
  secondLineMode: FoldSecondLineModeId;
  kind: FoldCrimpKind;
  /** One per flap that opens more than one way, as the engine stores it. */
  openings: readonly FoldOpeningChoice[];
  completion: FoldCompletionChoice | null;
}

/** The picks that locate the first line, and the ones past them that locate the second. */
export function crimpPicks<T>(intent: Pick<FoldCrimpIntent, 'lineMode'> & { picks: readonly T[] }): {
  first: readonly T[];
  second: readonly T[];
} {
  const count = lineModeInput(intent.lineMode).steps.length;
  return { first: intent.picks.slice(0, count), second: intent.picks.slice(count) };
}

/** The crimp step the intent describes, from the state `index` was made for; or why there is none yet. */
export function buildCrimpStep(intent: FoldCrimpIntent, index: FoldPickIndex): FoldStepBuild {
  const { first: firstPicks, second: secondPicks } = crimpPicks(intent);
  const first = locateAlongLine({ ...intent, picks: firstPicks }, index, false);
  if ('status' in first) return first;
  const second = locateSecondLine(intent.secondLineMode, secondPicks, index);
  if ('status' in second) return second;
  const { line, choices: rooted, along, sceneLine, movingSign, acrossLayers } = first;
  const op: FoldCrimpOp = { kind: 'crimp', line, second: second.line, crimp: intent.kind, ...along };
  const choices: FoldChoices = {
    ...rooted,
    ...(intent.completion ? { completion: intent.completion } : {}),
    ...(intent.openings.length > 0 ? { opening: intent.openings } : {}),
  };
  return {
    status: 'built',
    op,
    ...(Object.keys(choices).length > 0 ? { choices } : {}),
    sceneLine,
    movingSign,
    via: line.via,
    scope: along.seed.scope,
    ...(acrossLayers ? { acrossLayers } : {}),
  };
}

/**
 * Where a crimp's lines lie on the folded pane as the tools located them, in
 * the scene frame, each across the paper: the first once its clicks are in,
 * the second once its are. What the pane draws while the second line is
 * being located, and the second line beside the fold's own picture.
 */
export interface FoldCrimpLines {
  first: [Point, Point] | null;
  second: [Point, Point] | null;
}

export function crimpLines(intent: FoldCrimpIntent, index: FoldPickIndex): FoldCrimpLines {
  const { first: firstPicks, second: secondPicks } = crimpPicks(intent);
  const across = (line: FoldModelLine) => lineAcrossPaper(index, line);
  const first = locateAlongLine({ ...intent, picks: firstPicks }, index, false);
  const second = locateSecondLine(intent.secondLineMode, secondPicks, index);
  return {
    first: 'status' in first ? null : across(first.sceneLine),
    second: 'status' in second ? null : across(second.sceneLine),
  };
}


/** Crimp keeps its feasible-choice behavior; explicit preselection belongs to Reverse. */
export function crimpKindToFold(chosen: FoldCrimpKind | null, kinds: readonly FoldCrimpKind[]): FoldCrimpKind {
  return kinds.length === 1 ? kinds[0]! : (chosen ?? 'inside');
}
