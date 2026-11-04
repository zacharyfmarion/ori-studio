/**
 * A swivel by its valley and mountain's other end: where one of its creases
 * runs on to another folded edge, a second swivel can share that crease, and
 * the two fold together (engine `compound::swivel_pair`). The engine names
 * that end in the swivel's preview (`other_end`); the tools offer it once
 * the swivel is previewed, and on taking it go on to locate the second
 * swivel's lines with the first's held (`FoldToolState.otherEnd`).
 *
 * Pure: no React, no store, no engine.
 */
import type { FoldSwivelOtherEndAnalysis, FoldVertexAnalysed } from '../../engine/foldEngineSquashWire';
import type { FoldSwivelOtherEndTaken, FoldTakenLine, FoldToolState } from '../../tools/foldToolState';
import { lineThrough, toPoint } from '../foldCanvasGeometry';
import type { FoldPickIndex } from '../foldPicking';

/** The other end the engine names in a single swivel's preview; null for a pair, any other fold, or none. */
export function swivelOtherEndOffered(
  tools: Pick<FoldToolState, 'tool' | 'swivelInput' | 'otherEnd'>,
  answer: FoldVertexAnalysed | null
): FoldSwivelOtherEndAnalysis | null {
  if (tools.tool !== 'swivel' || tools.swivelInput !== 'valley-mountain' || tools.otherEnd) return null;
  const analysis = answer?.analysis;
  return analysis?.kind === 'swivel-valley-mountain' ? analysis.other_end ?? null : null;
}

/**
 * The first swivel taken as one of two, from its preview: its valley taken,
 * its mountain located now, the crease the engine says runs on, and that
 * crease's line on the folded pane — through the two vertices. Null while
 * there is no other end, or either line is not in.
 */
export function swivelOtherEndTaken(
  index: FoldPickIndex | null,
  tools: Pick<FoldToolState, 'tool' | 'swivelInput' | 'otherEnd' | 'takenLine'>,
  answer: FoldVertexAnalysed | null,
  located: FoldTakenLine | null | undefined
): FoldSwivelOtherEndTaken | null {
  const end = swivelOtherEndOffered(tools, answer);
  const analysis = answer?.analysis;
  if (!index || !end || analysis?.kind !== 'swivel-valley-mountain' || !tools.takenLine || !located) return null;
  const meetingLine = lineThrough(index.toScene(toPoint(analysis.vertex)), index.toScene(toPoint(end.vertex)));
  if (!meetingLine) return null;
  return { valley: tools.takenLine, mountain: located, shared: end.shared, meetingLine };
}
