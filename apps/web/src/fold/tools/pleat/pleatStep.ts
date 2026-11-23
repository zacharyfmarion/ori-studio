import { sideOf } from '../../canvas/foldCanvasGeometry';
import { topSheetPointAt, type FoldPickIndex } from '../../canvas/foldPicking';
import type { FoldAxiomCandidate } from '../../engine/foldEngineWire';
import type { FoldToolState } from '../foldToolState';
import type { FoldModelLine, FoldPleatOp } from '../../document/foldSequenceDocument';
import type { FoldSecondLineModeId } from '../foldToolCatalog';
import { crimpPicks } from '../crimp/crimpStep';
import {
  lineAcrossPaper,
  locateAlongLine,
  locate,
  type FoldAlongLocated,
  type FoldLocateIntent,
  type FoldStepBuild,
} from '../foldStepBuilder';

export interface FoldPleatIntent extends FoldLocateIntent {
  secondLineMode: FoldSecondLineModeId;
  secondCandidate?: FoldAxiomCandidate | null;
}

/** The valley line's own construction, made on the same starting pose. */
function valleyIntent(intent: FoldPleatIntent): FoldLocateIntent {
  return { ...intent, lineMode: intent.secondLineMode, picks: crimpPicks(intent).second, candidate: intent.secondCandidate ?? null };
}

/** A second independent construction, made on the same starting pose. */
function locateValley(intent: FoldPleatIntent, index: FoldPickIndex) {
  const result = locate(valleyIntent(intent), index);
  if (!result) return { status: 'unlocated' as const };
  if ('status' in result) return { status: 'refused' as const, refused: result };
  return result;
}

/** The mountain line, the step's own: its line, its root and where it lies; null until it is located. */
function locateMountain(intent: FoldPleatIntent, index: FoldPickIndex) {
  const result = locate({ ...intent, picks: crimpPicks(intent).first }, index);
  return result && !('status' in result) ? result : null;
}

/** The line `intent` locates, its moving side the one that holds `other`'s stretch across the paper. */
function locateToward(intent: FoldLocateIntent, index: FoldPickIndex, other: FoldModelLine) {
  const own = locateAlongLine({ ...intent, swapped: false }, index, false);
  if ('status' in own) return own;
  const span = lineAcrossPaper(index, other);
  if (!span) return own;
  const distance = sideOf(own.sceneLine, {
    x: (span[0].x + span[1].x) / 2,
    y: (span[0].y + span[1].y) / 2,
  });
  // On the line: the engine refuses two lines that are one (`lines`).
  if (Math.abs(distance) < 1e-8) return locateAlongLine(intent, index, false);
  const toward = distance > 0 ? 1 : -1;
  return locateAlongLine({ ...intent, swapped: own.movingSign !== toward }, index, false);
}

/** The pleat's first fold as located; `mountainEnd` when it is the valley's, the end beyond the mountain line moving. */
export type FoldPleatFirst = FoldAlongLocated & { mountainEnd?: true };

/**
 * The line a pleat folds first, with its moving side and what moves, once
 * both lines are specified. By default the mountain line, its moving side
 * toward the valley line: the end beyond the valley line moves. Swap moves
 * the end beyond the mountain line instead: the valley line folds first, its
 * moving side toward the mountain line, so the layers picked are the ones on
 * that side of the valley line. Until the valley line is located, the
 * mountain line as the tools locate it.
 */
export function locatePleatFirst(
  intent: FoldPleatIntent,
  index: FoldPickIndex,
): FoldPleatFirst | Exclude<ReturnType<typeof locateAlongLine>, FoldAlongLocated> {
  const firstIntent = { ...intent, picks: crimpPicks(intent).first };
  const mountain = locateAlongLine({ ...firstIntent, swapped: false }, index, false);
  const valley = locateValley(intent, index);
  if ('status' in mountain || 'status' in valley)
    return locateAlongLine(firstIntent, index, false);
  if (intent.swapped) {
    const first = locateToward({ ...valleyIntent(intent), swapped: false }, index, mountain.sceneLine);
    return 'status' in first ? first : { ...first, mountainEnd: true };
  }
  return locateToward(firstIntent, index, valley.sceneLine);
}

export function buildPleatStep(
  intent: FoldPleatIntent,
  index: FoldPickIndex,
): FoldStepBuild {
  const first = locatePleatFirst(intent, index);
  if ('status' in first) return first;
  const second = locateValley(intent, index);
  if ('status' in second) return second;
  // The mountain is the step's line, and its root the step's choice, whichever line folds first.
  const mountain = first.mountainEnd ? locateMountain(intent, index) : first;
  if (!mountain) return { status: 'unlocated' };
  const { line, choices, acrossLayers } = mountain;
  const { along, sceneLine, movingSign } = first;
  const op: FoldPleatOp = {
    kind: 'pleat',
    line,
    second: second.line,
    ...(second.choices?.root ? { secondRoot: second.choices.root } : {}),
    ...(first.mountainEnd ? { end: 'mountain' as const } : {}),
    ...along,
  };
  return {
    status: 'built',
    op,
    choices,
    sceneLine,
    movingSign,
    via: line.via,
    scope: along.seed.scope,
    ...(acrossLayers ? { acrossLayers } : {}),
  };
}

/** The two lines as drawn: the mountain and the valley, whichever folds first. */
export function pleatLines(intent: FoldPleatIntent, index: FoldPickIndex) {
  const first = locatePleatFirst(intent, index);
  const mountain = 'status' in first ? null : first.mountainEnd ? locateMountain(intent, index) : first;
  const second = locateValley(intent, index);
  return {
    first: mountain ? lineAcrossPaper(index, mountain.sceneLine) : null,
    second:
      'status' in second ? null : lineAcrossPaper(index, second.sceneLine),
  };
}

/**
 * The drawn midpoint of the line that folds second — on the side that
 * moves: the valley line's, or with Swap the mountain line's — names the
 * visible flap, not a distant stack on its extension.
 */
export function pleatMaterialPoint(
  tools: Pick<FoldToolState, 'tool' | 'lineMode' | 'picks' | 'swapped'>,
  index: FoldPickIndex,
) {
  if (tools.tool !== 'pleat') return null;
  const picks = crimpPicks(tools);
  const [a, b] = tools.swapped ? picks.first : picks.second;
  const ends =
    a?.kind === 'segment'
      ? a.scene
      : a?.kind === 'free' && b?.kind === 'free'
        ? [a.scene, b.scene]
        : null;
  return ends
    ? topSheetPointAt(index, {
        x: (ends[0]!.x + ends[1]!.x) / 2,
        y: (ends[0]!.y + ends[1]!.y) / 2,
      })
    : null;
}
