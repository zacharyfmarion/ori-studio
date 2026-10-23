import { sideOf } from '../../canvas/foldCanvasGeometry';
import { topSheetPointAt, type FoldPickIndex } from '../../canvas/foldPicking';
import type { FoldAxiomCandidate } from '../../engine/foldEngineWire';
import type { FoldToolState } from '../foldToolState';
import type { FoldPleatOp } from '../../document/foldSequenceDocument';
import type { FoldSecondLineModeId } from '../foldToolCatalog';
import { crimpPicks } from '../crimp/crimpStep';
import {
  lineAcrossPaper,
  locateAlongLine,
  locate,
  type FoldLocateIntent,
  type FoldStepBuild,
} from '../foldStepBuilder';

export interface FoldPleatIntent extends FoldLocateIntent {
  secondLineMode: FoldSecondLineModeId;
  secondCandidate?: FoldAxiomCandidate | null;
}

/** A second independent construction, made on the same starting pose. */
function locateValley(intent: FoldPleatIntent, index: FoldPickIndex) {
  const result = locate({ ...intent, lineMode: intent.secondLineMode,
    picks: crimpPicks(intent).second, candidate: intent.secondCandidate ?? null }, index);
  if (!result) return { status: 'unlocated' as const };
  if ('status' in result) return { status: 'refused' as const, refused: result };
  return result;
}

/** Both lines are specified before folding: default toward the valley line. */
export function locatePleatFirst(
  intent: FoldPleatIntent,
  index: FoldPickIndex,
) {
  const picks = crimpPicks(intent);
  const firstIntent = { ...intent, picks: picks.first };
  const first = locateAlongLine(
    { ...firstIntent, swapped: false },
    index,
    false,
  );
  const second = locateValley(intent, index);
  if ('status' in first || 'status' in second)
    return locateAlongLine(firstIntent, index, false);
  const span = lineAcrossPaper(index, second.sceneLine);
  if (!span) return first;
  const distance = sideOf(first.sceneLine, {
    x: (span[0].x + span[1].x) / 2,
    y: (span[0].y + span[1].y) / 2,
  });
  if (Math.abs(distance) < 1e-8)
    return locateAlongLine(firstIntent, index, false);
  const toward = distance > 0 ? 1 : -1;
  return locateAlongLine(
    {
      ...firstIntent,
      swapped: (first.movingSign !== toward) !== intent.swapped,
    },
    index,
    false,
  );
}

export function buildPleatStep(
  intent: FoldPleatIntent,
  index: FoldPickIndex,
): FoldStepBuild {
  const first = locatePleatFirst(intent, index);
  if ('status' in first) return first;
  const second = locateValley(intent, index);
  if ('status' in second) return second;
  const { line, choices, along, sceneLine, movingSign, acrossLayers } = first;
  const op: FoldPleatOp = {
    kind: 'pleat',
    line,
    second: second.line,
    ...(second.choices?.root ? { secondRoot: second.choices.root } : {}),
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

export function pleatLines(intent: FoldPleatIntent, index: FoldPickIndex) {
  const first = locatePleatFirst(intent, index);
  const second = locateValley(intent, index);
  return {
    first: 'status' in first ? null : lineAcrossPaper(index, first.sceneLine),
    second:
      'status' in second ? null : lineAcrossPaper(index, second.sceneLine),
  };
}

/** The line's drawn midpoint names the visible flap, not a distant stack on its extension. */
export function pleatMaterialPoint(
  tools: Pick<FoldToolState, 'tool' | 'lineMode' | 'picks' | 'swapped'>,
  index: FoldPickIndex,
) {
  if (tools.tool !== 'pleat' || tools.swapped) return null;
  const { second } = crimpPicks(tools);
  const a = second[0],
    b = second[1];
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
