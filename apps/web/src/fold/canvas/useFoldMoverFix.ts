import { useEffect, useState } from 'react';
import { reportError } from '../../monitoring';
import type { FoldOp } from '../document/foldSequenceDocument';
import type { FoldEngineRefused } from '../engine/foldEngineWire';
import type { FoldSessionSurface } from '../session/useFoldSession';
import { findMoverFix, moverStaysPoint, type FoldMoverFix } from '../tools/moverStays';
import { sheetPointsTogether, type FoldPick, type FoldPickIndex } from './foldPicking';
import type { FoldToolStep } from './useFoldToolPreview';

/** A pick at the point a refusal names: within what a stored sheet point round-trips to. */
const SAME = 1e-9;

/**
 * The fix a fold refused as its point staying put offers (`tools/moverStays`):
 * the same step with the point swapped for one at the same spot on paper
 * that folds. Asked of the engine once per refused step on the state on
 * screen — each try folded and let go at once — and only while the tools'
 * picks hold the point, which is what the fix swaps. Null while it is asked,
 * when none lands, and for every other refusal.
 */
export function useFoldMoverFix(
  session: FoldSessionSurface,
  index: FoldPickIndex | null,
  step: FoldToolStep | null,
  refused: FoldEngineRefused | null,
  picks: readonly FoldPick[]
): FoldMoverFix | null {
  const { withCursor } = session;
  const state = session.cursor.state;
  const from = moverStaysPoint(refused);
  const picked =
    from !== null &&
    picks.some((pick) => pick.kind === 'point' && Math.abs(pick.sheet[0] - from[0]) <= SAME && Math.abs(pick.sheet[1] - from[1]) <= SAME);
  const key = state && step && index && from && picked ? `${state.generation}:${state.id}|${step.key}|${from.join(',')}` : null;
  const [found, setFound] = useState<{ key: string; fix: FoldMoverFix | null } | null>(null);
  useEffect(() => {
    if (key === null || !step || !index || found?.key === key) return undefined;
    let current = true;
    const lands = async (op: FoldOp) => {
      const answer = await withCursor(async (engine, at) => {
        const landed = await engine.step(at, op, step.choices);
        if (landed.status === 'ok') await engine.release([landed.state]);
        return landed.status === 'ok';
      });
      return answer.status === 'answered' && answer.value;
    };
    void findMoverFix(step.op, refused, (point) => sheetPointsTogether(index, point), lands).then(
      (fix) => {
        if (current) setFound({ key, fix });
      },
      (error: unknown) => reportError(error, { surface: 'fold:mover-fix' })
    );
    return () => {
      current = false;
    };
    // The step, the state and the refusal are read through the key: an equal ask must not ask again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [withCursor, key, found?.key]);
  return found && found.key === key ? found.fix : null;
}
