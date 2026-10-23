/**
 * The tuck's step (plan Phase 11, research §4.4 and §5.2): from what the
 * tools picked and what the engine said of the layers, to the op and choices
 * a document stores.
 *
 * - **The line, the moving side and the seed** are a plain fold's
 *   (`locateAlongLine`), in any line mode: what moves is the flap the seed
 *   names, grown by the engine's bounded closure.
 * - **The direction**, as the viewer sees it, names the placement: a valley
 *   tuck goes under its target, a mountain tuck over it.
 * - **The target** is one of the layers the engine lists as taking the tuck
 *   (`FoldTuckAnalysis.targets`), never a free pick of any layer: only 40%
 *   of the layers a plain fold lands on take one. The step stores its
 *   interior sheet point, as the engine names it.
 * - **The order**, when the completion leaves more than one, is the
 *   completion that picks it (plan D6).
 *
 * Pure: no React, no store, no engine.
 */
import type {
  FoldChoices,
  FoldCompletionChoice,
  FoldDirection,
  FoldTuckOp,
  SheetPoint,
} from '../../document/foldSequenceDocument';
import type { FoldPickIndex } from '../../canvas/foldPicking';
import type { FoldTuckAnalysis, FoldTuckTarget } from '../../engine/foldEngineCrimpTuckWire';
import { locateAlongLine, type FoldLocateIntent, type FoldStepBuild } from '../foldStepBuilder';

/** What the tools have picked for a tuck, and the choices made of what the engine lists. */
export interface FoldTuckIntent extends FoldLocateIntent {
  direction: FoldDirection;
  /** The listed target's sheet point; null while the targets are being asked for. */
  target: SheetPoint | null;
  additionalTargets?: readonly SheetPoint[];
  completion: FoldCompletionChoice | null;
}

/**
 * The sheet point a tuck asks its targets with: the listing reads no target
 * (`State::analyse_tuck`), but the op names one, and the bridge checks only
 * that it is a point.
 */
export const TUCK_TARGET_UNASKED: SheetPoint = [0, 0];

/**
 * The tuck step the intent describes, from the state `index` was made for;
 * or why there is none yet. With no target, the op the targets are asked
 * with (`TUCK_TARGET_UNASKED`).
 */
export function buildTuckStep(intent: FoldTuckIntent, index: FoldPickIndex): FoldStepBuild {
  const located = locateAlongLine(intent, index, false);
  if ('status' in located) return located;
  const { line, choices: rooted, along, sceneLine, movingSign, acrossLayers } = located;
  const op: FoldTuckOp = {
    kind: 'tuck',
    line,
    direction: intent.direction,
    target: intent.target ?? TUCK_TARGET_UNASKED,
    ...along,
    ...(intent.additionalTargets?.length ? { additionalTargets: intent.additionalTargets } : {}),
  };
  const choices: FoldChoices = {
    ...rooted,
    ...(intent.completion ? { completion: intent.completion } : {}),
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
 * The layers a tuck may go against, as the tools offer them: those the
 * engine found take it, in its order (by face), then those its budget left
 * undecided (`feasible: null`), which the fold itself decides. A layer that
 * does not take the tuck is never offered.
 */
export function tuckTargetsOf(analysis: FoldTuckAnalysis | null): FoldTuckTarget[] {
  if (!analysis) return [];
  return [
    ...analysis.targets.filter((target) => target.feasible === true),
    ...analysis.targets.filter((target) => target.feasible === null),
  ];
}

/**
 * The target taken: the face the folder chose while it is listed, else the
 * first listed; null when none is.
 */
export function tuckTargetChosen(targets: readonly FoldTuckTarget[], face: number | null): FoldTuckTarget | null {
  return targets.find((target) => target.face === face) ?? targets[0] ?? null;
}

/** The face `delta` places along the listed targets from `face`, wrapping round; null when none is listed. */
export function steppedTuckTarget(targets: readonly FoldTuckTarget[], face: number | null, delta: number): number | null {
  if (targets.length === 0) return null;
  const at = Math.max(0, targets.findIndex((target) => target.face === face));
  const next = (((at + delta) % targets.length) + targets.length) % targets.length;
  return targets[next]!.face;
}
