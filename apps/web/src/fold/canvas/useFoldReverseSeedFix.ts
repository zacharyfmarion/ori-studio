import { useEffect, useMemo, useState } from 'react';
import { reportError } from '../../monitoring';
import type { FoldChoices, FoldOp } from '../document/foldSequenceDocument';
import { isFoldCompoundOp } from '../engine/foldEngineCompoundWire';
import type { FoldReverseAsked } from '../engine/foldEngineReverseWire';
import type { FoldAxiomCandidate, FoldCrossSection, FoldEngineRefused } from '../engine/foldEngineWire';
import { foldStepInputKey } from '../session/foldSessionEngine';
import type { FoldSessionSurface } from '../session/useFoldSession';
import type { FoldSeededToolState } from '../tools/foldToolState';
import { findReverseSeedFix, narrowerReverseFlaps, type FoldReverseSeedFix } from '../tools/reverse/reverseSeedFix';
import { reverseDrawnSegment } from '../tools/reverse/reverseSegmentSeed';
import { buildReverseStep } from '../tools/reverse/reverseStep';
import type { FoldPickIndex } from './foldPicking';

/**
 * The fix a reverse fold refused for its tip offers (`tools/reverse/
 * reverseSeedFix`): only the flaps its drawn line crosses, when it took
 * more. Asked of the engine once per refused fold on the state on screen —
 * the tip described, then each way it opens — and offered only when one
 * lands. Null while it is asked, when none lands, and for every other fold.
 */
export function useFoldReverseSeedFix(
  session: FoldSessionSurface,
  index: FoldPickIndex | null,
  tools: FoldSeededToolState,
  candidate: FoldAxiomCandidate | null,
  section: FoldCrossSection | null,
  refused: FoldEngineRefused | null
): FoldReverseSeedFix | null {
  const { withCursor } = session;
  const state = session.cursor.state;
  const { tool, lineMode, picks, override, swapped, seed } = tools;
  const wanted = tools.compound.reverseKind;
  const drawn = useMemo(() => reverseDrawnSegment({ tool, lineMode, picks, override }), [tool, lineMode, picks, override]);
  const flaps = narrowerReverseFlaps(refused, seed, section, drawn);
  // The fold with only those flaps, as the tools would build it.
  const step = useMemo(() => {
    if (!flaps || !index) return null;
    const built = buildReverseStep(
      { lineMode, picks, candidate, swapped, seed: { scope: 'flaps', flaps }, kind: wanted ?? 'inside', openings: [], completion: null },
      index
    );
    return built.status === 'built' ? { op: built.op, ...(built.choices ? { choices: built.choices } : {}) } : null;
    // The flaps are read through the refusal and the seed they are worked out from.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refused, seed, section, drawn, index, lineMode, picks, candidate, swapped, wanted]);
  const key = state && step ? `${state.generation}:${state.id}|${foldStepInputKey(step)}|${wanted ?? 'auto'}` : null;
  const [found, setFound] = useState<{ key: string; fix: FoldReverseSeedFix | null } | null>(null);
  useEffect(() => {
    if (key === null || !step || !flaps || found?.key === key) return undefined;
    let current = true;
    const ask = async (op: FoldOp, choices: FoldChoices | undefined): Promise<FoldReverseAsked | null> => {
      if (!isFoldCompoundOp(op)) return null;
      const answer = await withCursor((engine, at) => engine.compoundAnalysis(at, op, choices));
      if (answer.status !== 'answered') return null;
      const value = answer.value;
      return value.status === 'ok' && value.family === 'reverse' ? value : null;
    };
    void findReverseSeedFix(flaps, step, ask, wanted).then(
      (fix) => {
        if (current) setFound({ key, fix });
      },
      (error: unknown) => reportError(error, { surface: 'fold:reverse-seed-fix' })
    );
    return () => {
      current = false;
    };
    // The step, the state and the kind wanted are read through the key: an equal ask must not ask again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [withCursor, key, found?.key]);
  return found && found.key === key ? found.fix : null;
}
