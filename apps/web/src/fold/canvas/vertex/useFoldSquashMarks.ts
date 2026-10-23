import { useCallback, useMemo } from 'react';
import type { Point } from '../../../lib/geometry';
import { canonicalJson } from '../../document/foldDigest';
import type { FoldSquashAnalysis, FoldVertexAnalysis } from '../../engine/foldEngineSquashWire';
import type { FoldSessionSurface } from '../../session/useFoldSession';
import type { FoldToolState } from '../../tools/foldToolState';
import { sameSquashFlap, squashRegionOnFolded } from '../../tools/vertex/squashGeometry';
import { squashFlapKey, squashOpAt, storedLine } from '../../tools/vertex/vertexStep';
import type { FoldOverlayRegions } from '../foldPaneOverlays';
import type { FoldHit, FoldPaneId, FoldPickIndex } from '../foldPicking';
import { useFoldFlapAnswers } from './useFoldFlapAnswers';

/** What a squash's flap click lights before it is made, and the hover that feeds it. */
export interface FoldSquashMarks {
  /** The flaps the engine has described under the pointer, on the folded pane; null when no flap is being picked. */
  regions: Readonly<Record<FoldPaneId, FoldOverlayRegions>> | null;
  /** Told what is under the pointer on the folded pane (`FoldPane`'s `onHover`). */
  onHover: (hit: FoldHit | null) => void;
}

/** A squash the engine describes, from its answer: none for another kind's. */
const readSquash = (analysis: FoldVertexAnalysis): FoldSquashAnalysis | null => (analysis.kind === 'squash' ? analysis : null);

/** The scene point a hit names on the paper: a free pick's. */
function paperOf(hit: FoldHit | null): Point | null {
  return hit?.pick?.kind === 'free' && hit.pick.sheet ? hit.pick.scene : null;
}

const NO_REGION: FoldOverlayRegions = { polygons: [], picked: null, at: () => null };

/**
 * A squash's flap under the pointer, before it is clicked (owner feedback,
 * 2026-10-21: picking the flap had no preview). Each flap the pointer
 * crosses on the folded pane is asked of the engine once (a key of the layer
 * there, and about a drawn hinge its side of it, `squashFlapKey`), and one it
 * describes is lit — both layers, bounded as the hinge chosen bounds them:
 * the whole flap about its folded edge, only the end on the pointer's side
 * about a drawn line, once that is taken. A place the engine names no flap
 * at is not lit; a click there is refused, in words that say why.
 *
 * Null regions for any other tool, after the flap is clicked, and while a
 * drawn hinge is still being located.
 */
export function useFoldSquashMarks(
  session: FoldSessionSurface,
  index: FoldPickIndex | null,
  tools: Pick<FoldToolState, 'tool' | 'squashHinge' | 'takenLine' | 'picks' | 'vertexDirection'>
): FoldSquashMarks {
  const state = session.cursor.state;
  const stateKey = state ? `${state.generation}:${state.id}` : null;
  const { tool, squashHinge, takenLine, picks, vertexDirection: direction } = tools;
  const drawn = squashHinge === 'line';
  const choosing = tool === 'squash' && picks.length === 0 && (!drawn || takenLine !== undefined);
  const hinge = useMemo(() => (drawn ? storedLine(takenLine) : undefined), [drawn, takenLine]);
  const sceneLine = drawn ? (takenLine?.sceneLine ?? null) : null;
  const intent = useMemo(() => ({ direction, squashHinge: squashHinge ?? 'folded', hinge }), [direction, squashHinge, hinge]);
  const scope = choosing && stateKey ? `${stateKey}|${hinge ? canonicalJson(hinge) : 'folded'}|${direction}` : null;
  const { byKey, ask } = useFoldFlapAnswers(session, scope, readSquash, 'fold:squash-flap');

  const keyAt = useCallback(
    (hit: FoldHit | null) => {
      const at = paperOf(hit);
      return at && index ? squashFlapKey(index, direction, sceneLine, at) : null;
    },
    [index, direction, sceneLine]
  );

  const onHover = useCallback(
    (hit: FoldHit | null) => {
      if (!choosing || !index) return;
      const at = paperOf(hit);
      const key = keyAt(hit);
      if (key && at) ask(key, squashOpAt(index, intent, at));
    },
    [choosing, index, keyAt, ask, intent]
  );

  // The flaps the engine described, each once, with where each key lies.
  const flaps = useMemo(() => {
    const list: { analysis: FoldSquashAnalysis; folded: Point[][] }[] = [];
    const of = new Map<string, number>();
    if (!index) return { list, of };
    for (const [key, answer] of Object.entries(byKey)) {
      if (answer.status !== 'flap') continue;
      let at = list.findIndex((flap) => sameSquashFlap(flap.analysis, answer.analysis));
      if (at < 0) {
        at = list.length;
        list.push({ analysis: answer.analysis, folded: squashRegionOnFolded(index, answer.analysis, drawn) });
      }
      of.set(key, at);
    }
    return { list, of };
  }, [index, byKey, drawn]);

  const regions = useMemo<FoldSquashMarks['regions']>(() => {
    if (!choosing || !index) return null;
    const at = (hit: FoldHit) => {
      const key = keyAt(hit);
      return key === null ? null : (flaps.of.get(key) ?? null);
    };
    return { folded: { polygons: flaps.list.map((flap) => flap.folded), picked: null, at }, 'crease-pattern': NO_REGION };
  }, [choosing, index, keyAt, flaps]);

  return { regions, onHover };
}
