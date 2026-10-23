import { useEffect, useMemo, useRef } from 'react';
import { trackFoldChoiceOffered } from '../../../analytics';
import {
  isFoldedSwivelOp,
  swivelKindOf,
  type FoldChoices,
  type FoldCompletionChoice,
  type FoldDirection,
  type FoldLocatedLine,
  type FoldSwivelKind,
  type FoldVertexOp,
} from '../../document/foldSequenceDocument';
import type { FoldVertexAnalysed } from '../../engine/foldEngineSquashWire';
import type { FoldEngineRefused } from '../../engine/foldEngineWire';
import type { FoldSessionSurface } from '../../session/useFoldSession';
import { isVertexTool } from '../../tools/foldToolCatalog';
import type { FoldToolState } from '../../tools/foldToolState';
import {
  fanCenterScene,
  fanHasNoFourth,
  fanLayerCount,
  fanAnchorAlternative,
  landingFourths,
  storedLine,
  swivelDirectionsOf,
  swivelKindsLanding,
  vertexAskedOp,
  vertexChosenOp,
  vertexStepFrom,
  type FoldVertexIntent,
  type FoldVertexTaken,
} from '../../tools/vertex/vertexStep';
import { swivelPickedLanding, type FoldSwivelReachView } from '../../tools/vertex/swivelReach';
import type { FoldPickIndex } from '../foldPicking';
import { useFoldCompoundAsk } from '../useFoldCompoundAsk';
import { useFoldSwivelReach } from './useFoldSwivelReach';

/** What the vertex tool knows of the fold it is previewing, beside the step. */
export interface FoldVertexPreview {
  /** The engine's first answer — the geometry, every fourth-ray candidate and which land; null until it is in. */
  base: FoldVertexAnalysed | null;
  /** Its answer for the op folded, with the choices made: what its orders are read from. */
  answer: FoldVertexAnalysed | null;
  /**
   * A fan's fourth ray taken, by index into the candidates — a swivel's
   * ridge, by index into its ridges; null for no fan, none yet, or none that
   * lands.
   */
  emergent: number | null;
  /**
   * A fan's fourth creases that land, by index into the candidates — a
   * swivel's ridges that land: the only ones offered (`landingFourths`).
   * Empty for any other fold, before the engine has described it, and when
   * none lands.
   */
  fourths: readonly number[];
  /**
   * When none lands with the paper picked to stay: whether one would with
   * other paper staying — what the window offers in its place. Null while
   * that is asked, and whenever one lands.
   */
  elsewhere: boolean | null;
  /** The way it folds, as the viewer sees it — the folder's, always: what its creases' letters are read from (`vertexCreaseLines`). */
  direction: FoldDirection;
  /** The orders the step leaves, when more than one; the one taken. */
  orders: readonly FoldCompletionChoice[];
  order: FoldCompletionChoice | null;
  /** The layers at a rabbit ear's center; 0 for any other fold. */
  layers: number;
  /**
   * A swivel's reach from where its creases meet (`useFoldSwivelReach`): the
   * edges that can swing and the lines each lands on. Absent or null for
   * any other fold, and before the meeting point.
   */
  reach?: FoldSwivelReachView | null;
  /**
   * Valley, then mountain: whether the fold lands that way, once known — a
   * swivel on a folded edge's from the engine's answer, of the kind it
   * folds; a swivel at a free vertex's from its reach. Absent or null when
   * unknown, and for the other folds.
   */
  directions?: readonly boolean[] | null;
  /**
   * A swivel on a folded edge's kind as it folds: the folder's, always.
   * Absent for the other folds, and before the engine has described it.
   */
  kind?: FoldSwivelKind;
  /** Open, then inside: whether a swivel on a folded edge lands that kind one way or the other, once known. */
  kinds?: readonly [boolean, boolean];
}

export interface FoldVertexStepAnswer {
  /** What a commit appends: the folded op, and the completion that picks its order; null until it is known. */
  step: { op: FoldVertexOp; choices?: FoldChoices } | null;
  vertex: FoldVertexPreview | null;
  /** Why it cannot be folded before it is previewed: a click off the paper, the engine's question. */
  refused: FoldEngineRefused | null;
}

const NONE: FoldVertexStepAnswer = { step: null, vertex: null, refused: null };

/**
 * A vertex tool's step (plan Phase 11), the reverse tool's `useFoldReverseStep`
 * for the squash, petal fold, rabbit ear and swivel: the clicks asked about
 * (the compound question, `useFoldCompoundAsk`) as a flap, a line or a fan;
 * then, once the folder's choices make it another fold — a squash's spine
 * aimed off its hinge, a fan's fourth ray other than the one asked — asked
 * again as it will be folded, for the orders it leaves. The step is built
 * from those answers with the choices taken
 * (`tools/vertex/vertexStep`, `vertexChosenOp` and `vertexStepFrom`); while an
 * answer is on its way there is no step, so nothing is previewed against a
 * fold the engine has not described. The preview and the commit go through
 * the session as every step's do.
 *
 * A rabbit ear tries the other stationary anchor when the first cannot
 * support the selected hinge. Neither attempt changes the hinge region.
 */
export function useFoldVertexStep(
  session: FoldSessionSurface,
  index: FoldPickIndex | null,
  tools: FoldToolState,
  enabled: boolean,
  swivelMountain?: FoldLocatedLine
): FoldVertexStepAnswer {
  const state = session.cursor.state;
  const stateKey = state ? `${state.generation}:${state.id}` : null;
  const { tool, petalHinge, swivelTarget, swivelInput, squashHinge, takenLine, picks, vertexDirection, compound } = tools;
  const { squashTarget, fanLayers, emergent: chosenEmergent, order: chosenOrder } = compound;

  // --- A swivel by its edge's reach from where its creases meet: what its
  // next clicks are offered, and which ways and kinds its edge and line land.
  // It folds the folder's way and kind whatever the reach says.
  const reach = useFoldSwivelReach(session, stateKey, index, tools, enabled && tool === 'swivel' && swivelInput !== 'valley-mountain');
  const landing = swivelPickedLanding(reach, picks);
  const direction = vertexDirection;
  const swivelKind = compound.swivelKind ?? 'open';
  // The line taken — a swivel's valley, a squash's drawn hinge — as the op stores it: its scene line is the canvas's.
  const line = useMemo(() => storedLine(takenLine), [takenLine]);

  const intent = useMemo<FoldVertexIntent | null>(
    () =>
      enabled && isVertexTool(tool)
        ? {
            tool,
            petalHinge,
            swivelTarget,
            swivelInput,
            swivelValley: tool === 'swivel' ? line : undefined,
            swivelMountain,
            ...(tool === 'squash' ? { squashHinge: squashHinge ?? 'folded', hinge: squashHinge === 'line' ? line : undefined } : {}),
            picks,
            direction,
            fanLayers,
            swivelKind,
          }
        : null,
    [enabled, tool, petalHinge, swivelTarget, swivelInput, squashHinge, line, swivelMountain, picks, direction, fanLayers, swivelKind]
  );
  const taken = useMemo<FoldVertexTaken>(
    () => ({ squashTarget, emergent: chosenEmergent, order: chosenOrder }),
    [squashTarget, chosenEmergent, chosenOrder]
  );

  // --- The geometry, asked once per base op on a state.
  const asked = useMemo(() => (intent && index ? vertexAskedOp(intent, index) : null), [intent, index]);
  const initial = asked && 'kind' in asked ? asked : null;
  const told = asked && 'status' in asked ? asked : null;
  const first = useFoldCompoundAsk(session, stateKey, initial ? { op: initial } : null, 'vertex', 'fold:vertex');
  const needsAnchor = initial?.kind === 'rabbit-ear' && (first?.refused != null || fanHasNoFourth(first?.asked ?? null));
  const alternative = useMemo(
    () => (needsAnchor && intent && index && initial ? fanAnchorAlternative(intent, index, initial) : null),
    [needsAnchor, intent, index, initial]
  );
  const alternate = useFoldCompoundAsk(session, stateKey, alternative ? { op: alternative } : null, 'vertex', 'fold:vertex');
  const useAlternate = alternative !== null && alternate?.asked != null && !fanHasNoFourth(alternate.asked);
  const resolvingAnchor = alternative !== null && alternate === null;
  const base = useAlternate ? alternative : initial;
  const resolved = useAlternate ? alternate : first;
  const firstAnswer = resolvingAnchor ? null : resolved?.asked ?? null;

  // --- The op as it will be folded, asked again when a choice makes it another fold.
  const chosen = useMemo(
    () => (base && firstAnswer ? vertexChosenOp(base, firstAnswer, taken) : null),
    [base, firstAnswer, taken]
  );
  const again = chosen?.again ?? false;
  const second = useFoldCompoundAsk(
    session,
    stateKey,
    again && chosen ? { op: chosen.op } : null,
    'vertex',
    'fold:vertex'
  );
  const answer = again ? (second?.asked ?? null) : firstAnswer;
  const answerRefused = again ? (second?.refused ?? null) : null;

  // --- The step: the order taken, of what that answer lists.
  const built = useMemo(
    () => (chosen && answer ? vertexStepFrom(chosen.op, answer, taken) : null),
    [chosen, answer, taken]
  );

  // --- What the window and the canvas read beside the step.
  const center = intent ? fanCenterScene(intent) : null;
  const layers = center && index ? fanLayerCount(index, center) : 0;

  // Each choice offered is counted once, by what it was offered for: a fan's
  // fourth creases by the ones that land, the only ones offered — a swivel's
  // ridges likewise.
  const offered = useRef<{ emergent: string | null; order: string | null }>({ emergent: null, order: null });
  const fourths = useMemo(() => landingFourths(firstAnswer), [firstAnswer]);
  const candidates = fourths.length;
  const ridges = firstAnswer?.analysis.kind === 'swivel-by-edge';
  const firstKey = resolved?.key ?? null;
  const orderKey = again ? (second?.key ?? null) : firstKey;
  const orderCount = built?.orders.length ?? 0;
  useEffect(() => {
    if (firstKey !== null && candidates > 1 && offered.current.emergent !== firstKey) {
      offered.current.emergent = firstKey;
      trackFoldChoiceOffered(ridges ? 'ridge' : 'emergent', candidates);
    }
    if (orderKey !== null && orderCount > 1 && offered.current.order !== orderKey) {
      offered.current.order = orderKey;
      trackFoldChoiceOffered('order', orderCount);
    }
  }, [firstKey, candidates, ridges, orderKey, orderCount]);

  if (!intent) return NONE;
  const refused = told ?? (resolvingAnchor ? null : resolved?.refused) ?? answerRefused;
  // A swivel on a folded edge's kind folded, and the ways that land of it.
  const kind = chosen?.kind ?? null;
  const askedKind = base && isFoldedSwivelOp(base) ? swivelKindOf(base) : null;
  const directions =
    (firstAnswer && kind && askedKind ? swivelDirectionsOf(firstAnswer, kind, askedKind) : null) ??
    firstAnswer?.directions ??
    landing?.directions ??
    null;
  const kinds = swivelKindsLanding(firstAnswer) ?? landing?.kinds ?? null;
  return {
    step: refused || !built ? null : built.step,
    vertex: {
      base: firstAnswer,
      answer,
      emergent: chosen?.emergent ?? null,
      fourths,
      elsewhere: null,
      direction: chosen?.direction ?? intent.direction,
      orders: built?.orders ?? [],
      order: built?.order ?? null,
      layers,
      reach,
      directions,
      ...(kind ? { kind } : {}),
      ...(kinds ? { kinds } : {}),
    },
    refused,
  };
}
