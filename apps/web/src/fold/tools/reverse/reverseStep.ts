/**
 * The reverse fold's step (plan Phase 9, D6): from what the tools picked and
 * what the engine said of the tip, to the op and choices a document stores.
 *
 * - **The line, the tip side and the anchor** are a fold along a line's
 *   (`locateAlongLine`): the axiom's root, a free line, or an existing crease
 *   — never unfolded along, which a reverse fold does not do — the moving
 *   side the tip's, and the seed what the tip grows from.
 * - **The kind** preserves an explicit request, even when infeasible. With
 *   no request it takes the only feasible kind, or defaults to Inside. A
 *   refusal can offer another kind, but never silently changes intent.
 * - **The opening**, when a flap opens more than one way, is one of the ways
 *   the engine lists: each flap that has several takes one of its openings,
 *   the ways stepped through in the order the engine lists them.
 * - **The order**, when the completion leaves more than one, is one of the
 *   orders the engine lists for the kind, stored as the completion that
 *   picks it.
 *
 * What a step stores is each one's result — the upper block's witnesses, the
 * completion's FOLD triples — never an index (plan D6).
 *
 * Pure: no React, no store, no engine.
 */
import type {
  FoldChoices,
  FoldCompletionChoice,
  FoldOpeningChoice,
  FoldReverseKind,
  FoldReverseOp,
} from '../../document/foldSequenceDocument';
import type { FoldPickIndex } from '../../canvas/foldPicking';
import type { FoldOpening, FoldReverseAnalysis, FoldReverseAsked } from '../../engine/foldEngineReverseWire';
import { locateAlongLine, type FoldLocateIntent, type FoldStepBuild } from '../foldStepBuilder';

/** A bounded-memory indexed choice list. Arrays used by fixtures also satisfy it. */
export interface FoldReverseWays {
  readonly length: number;
  at(index: number): FoldReverseOpenWay | undefined;
  /** The engine's scan (or the exact integer index space) was exhausted. */
  readonly truncated?: boolean;
}

/** What the tools have picked for a reverse fold, and the choices made of what the engine lists. */
export interface FoldReverseIntent extends FoldLocateIntent {
  kind: FoldReverseKind;
  /** One per flap that opens more than one way, as the engine stores it. */
  openings: readonly FoldOpeningChoice[];
  completion: FoldCompletionChoice | null;
}

/** The reverse step the intent describes, from the state `index` was made for; or why there is none yet. */
export function buildReverseStep(intent: FoldReverseIntent, index: FoldPickIndex): FoldStepBuild {
  const located = locateAlongLine(intent, index, false);
  if ('status' in located) return located;
  const { line, choices: rooted, along, sceneLine, movingSign, acrossLayers } = located;
  const op: FoldReverseOp = { kind: intent.kind === 'inside' ? 'inside-reverse' : 'outside-reverse', line, ...along };
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

/** Explicit intent wins; automatic mode takes the only feasible kind, else Inside. */
export function reverseKindToFold(chosen: FoldReverseKind | null, landing: readonly FoldReverseKind[]): FoldReverseKind {
  if (chosen !== null) return chosen;
  return landing.length === 1 ? landing[0]! : 'inside';
}

/** One way the tip opens: per flap that opens several ways, its opening. */
export interface FoldReverseOpenWay {
  /** In the order of the flaps that have several. */
  openings: readonly FoldOpening[];
  /** What the step stores for it. */
  stored: readonly FoldOpeningChoice[];
}

/**
 * Index the Cartesian product without allocating it. Every returned engine
 * opening is reachable, including combinations beyond the old 16-item cap.
 * The last flap advances fastest. Truncation stays explicit if the engine
 * stopped scanning or the product exceeds exact JavaScript integer indexing.
 */
export function reverseOpenWays(analysis: FoldReverseAnalysis): FoldReverseWays {
  const choosing = analysis.flaps.filter((flap) => flap.openings.length > 1);
  let length = choosing.length === 0 ? 0 : 1;
  let truncated = analysis.flaps.some((flap) => flap.truncated);
  for (const flap of choosing) {
    const product = length * flap.openings.length;
    if (!Number.isSafeInteger(product)) truncated = true;
    length = Math.min(product, Number.MAX_SAFE_INTEGER);
  }
  return {
    length,
    truncated,
    at(index) {
      if (!Number.isSafeInteger(index) || index < 0 || index >= length) return undefined;
      const openings: FoldOpening[] = new Array(choosing.length);
      for (let f = choosing.length - 1; f >= 0; f--) {
        const choices = choosing[f]!.openings;
        openings[f] = choices[index % choices.length]!;
        index = Math.floor(index / choices.length);
      }
      return { openings, stored: openings.map((opening) => opening.stored) };
    },
  };
}

/** The orders the engine lists for a kind; none when it lands with one. */
export function reverseOrdersOf(asked: FoldReverseAsked | null, kind: FoldReverseKind): readonly FoldCompletionChoice[] {
  return asked?.orders.find((listed) => listed.kind === kind)?.orders ?? [];
}

/** The listed choice at a stepped index, kept in range: the first while the list is empty or the index stale. */
export function chosenAt<T>(list: { at(index: number): T | undefined }, index: number): T | null {
  return (index >= 0 && Number.isSafeInteger(index) ? list.at(index) : undefined) ?? list.at(0) ?? null;
}
