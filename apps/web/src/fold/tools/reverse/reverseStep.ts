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
 *   the ways stepped through as `reverseLandingWays` lists them — only those
 *   that land, the most even split first.
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
import type {
  FoldOpening,
  FoldReverseAnalysis,
  FoldReverseAsked,
  FoldReverseLandings,
  FoldReverseWay,
} from '../../engine/foldEngineReverseWire';
import type { FoldFlap } from '../../engine/foldEngineWire';
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

/** What the engine said of a tip before its opening is chosen: its flaps' openings, and how each way lands. */
export interface FoldReverseTip {
  analysis: FoldReverseAnalysis;
  /** Absent from an engine that does not say. */
  landings: FoldReverseLandings | null;
}

const BOTH_KINDS: readonly FoldReverseKind[] = ['inside', 'outside'];

function landsAs(way: FoldReverseWay, kind: FoldReverseKind): boolean | null {
  return kind === 'inside' ? way.inside : way.outside;
}

/**
 * The ways the Opening stepper lists, and the canvas's chooser steps
 * (plan Phase 9; owner feedback, 2026-11-04): only the ways that land.
 *
 * - **The kind in play** is the one asked for, or either on Automatic.
 * - **Landing ways first**, the most even split first — over the flaps that
 *   choose, the fewest more faces in one block than the other, which is the
 *   designer's step in 42 of 44 multi-opening reverse folds in real tutorial
 *   models — then the ways where Inside lands before those where only
 *   Outside does, then the engine's order.
 * - **Then the undecided**, in the engine's order: ways the ask's budget ran
 *   out on, and every way past the ones it lists, as a tuck lists its
 *   undecided targets last. Never a decided way that lands as neither kind.
 * - **The other kind's ways** when the kind asked for lands nowhere and the
 *   other does somewhere, so the refusal shown offers the other kind.
 * - **One way, the first**, when nothing lands and nothing is undecided: the
 *   refusal still names an opening, and the stepper, with one, hides.
 *
 * Without the engine's landings — an engine that does not say, or a tip
 * whose flaps open one way each — the ways are `reverseOpenWays`' own.
 */
export function reverseLandingWays(tip: FoldReverseTip, requested: FoldReverseKind | null): FoldReverseWays {
  const product = reverseOpenWays(tip.analysis);
  const decided = tip.landings?.ways ?? [];
  if (product.length <= 1 || decided.length === 0) return product;
  const choosing = tip.analysis.flaps.filter((flap) => flap.openings.length > 1);
  const indexOf = (way: FoldReverseWay) =>
    way.openings.reduce((at, opening, f) => at * (choosing[f]?.openings.length ?? 1) + opening, 0);
  const unevenness = (way: FoldReverseWay) =>
    way.openings.reduce((sum, j, f) => {
      const opening = choosing[f]?.openings[j];
      return sum + (opening ? Math.abs(opening.lower.length - opening.upper.length) : 0);
    }, 0);
  const landingAs = (kinds: readonly FoldReverseKind[]) =>
    decided.filter((way) => kinds.some((kind) => landsAs(way, kind) === true));
  const undecidedAs = (kinds: readonly FoldReverseKind[]) =>
    decided.filter(
      (way) => !kinds.some((kind) => landsAs(way, kind) === true) && kinds.some((kind) => landsAs(way, kind) === null)
    );
  // Every way past those the engine decided is undecided too.
  const tail = Math.max(0, product.length - decided.length);
  let kinds = requested ? [requested] : BOTH_KINDS;
  // The kind asked for lands at no way, and none is left to decide: the other kind's ways, when it lands.
  if (requested && landingAs(kinds).length === 0 && undecidedAs(kinds).length === 0 && tail === 0) {
    const other: readonly FoldReverseKind[] = [requested === 'inside' ? 'outside' : 'inside'];
    if (landingAs(other).length > 0) kinds = other;
  }
  const landing = landingAs(kinds)
    .map((way) => ({ at: indexOf(way), unevenness: unevenness(way), inside: way.inside === true }))
    .sort((a, b) => a.unevenness - b.unevenness || Number(b.inside) - Number(a.inside) || a.at - b.at)
    .map(({ at }) => at);
  const undecided = undecidedAs(kinds)
    .map(indexOf)
    .sort((a, b) => a - b);
  const head = [...landing, ...undecided];
  if (head.length === 0 && tail === 0) head.push(0);
  const length = head.length + tail;
  return {
    length,
    truncated: (product.truncated ?? false) || undecided.length > 0 || tail > 0,
    at(index) {
      if (!Number.isSafeInteger(index) || index < 0 || index >= length) return undefined;
      return product.at(index < head.length ? head[index]! : decided.length + (index - head.length));
    },
  };
}

/** The same way: each choosing flap's opening the same one the engine listed. */
function sameWay(a: FoldReverseOpenWay, b: FoldReverseOpenWay): boolean {
  return a.openings.length === b.openings.length && a.openings.every((opening, f) => opening === b.openings[f]);
}

/**
 * Where the way on screen is among the ways listed for another kind, so
 * choosing a kind keeps the opening shown; 0, the first, when it is not
 * listed there.
 */
export function openingForKind(tip: FoldReverseTip, way: FoldReverseOpenWay, kind: FoldReverseKind | null): number {
  const ways = reverseLandingWays(tip, kind);
  // A way that lands is listed before every undecided one: the engine decides at most 256.
  const searched = Math.min(ways.length, 2 * 256 + 1);
  for (let index = 0; index < searched; index += 1) {
    const listed = ways.at(index);
    if (listed && sameWay(listed, way)) return index;
  }
  return 0;
}

/** The tip's flaps the engine says it cannot be folded without, by the faces it names them by. */
export function lockedFlaps(tip: FoldReverseTip | null): readonly FoldFlap[] {
  const locked = tip?.landings?.locked ?? [];
  if (!tip || locked.length === 0) return [];
  return tip.analysis.flaps.filter((flap) => locked.includes(flap.index)).map((flap) => flap.flap);
}

/** The orders the engine lists for a kind; none when it lands with one. */
export function reverseOrdersOf(asked: FoldReverseAsked | null, kind: FoldReverseKind): readonly FoldCompletionChoice[] {
  return asked?.orders.find((listed) => listed.kind === kind)?.orders ?? [];
}

/** The listed choice at a stepped index, kept in range: the first while the list is empty or the index stale. */
export function chosenAt<T>(list: { at(index: number): T | undefined }, index: number): T | null {
  return (index >= 0 && Number.isSafeInteger(index) ? list.at(index) : undefined) ?? list.at(0) ?? null;
}
