/**
 * What a swivel can do from where its creases meet (owner feedback,
 * 2026-10-12: offer only the choices that land, and show them at every
 * pick). Once the meeting point is clicked, every edge the folder might
 * swing is asked against every line it might land on, through the compound
 * question, in one call in the worker: one round trip per pick, never one
 * per pointer move (plan D14, tier 1). What lands is kept with the answer
 * its preview draws, so the canvas lights the edges that can swing, then
 * the lines the edge picked can land on, and previews a swivel under the
 * pointer before it is clicked.
 *
 * A pair is offered when the engine folds it flat one way or the other — on a
 * folded edge, open or inside: a swivel on a folded edge says which kinds and
 * ways land in its answer, a swivel at a free vertex is asked both ways. It
 * is kept as it will be folded (`vertexChosenOp`): the folder's way and kind,
 * whether or not they land — a pair that lands only another way is folded
 * as asked and refused, and the refusal offers the other way (owner
 * feedback, 2026-10-20: never fold another way than the one asked without
 * saying so) — and the first ridge that lands. So the swivel previewed under
 * the pointer is the one a click previews and a commit folds.
 *
 * Pure: the compound question is handed in.
 */
import {
  withSwivelKind,
  type FoldDirection,
  type FoldModelLine,
  type FoldSwivelKind,
  type FoldVertexOp,
  type SheetPoint,
} from '../../document/foldSequenceDocument';
import type { FoldCompoundAnalysis } from '../../engine/foldEngineCompoundWire';
import type { FoldVertexAnalysed } from '../../engine/foldEngineSquashWire';
import type { FoldEngineOutcome } from '../../engine/foldEngineWire';
import type { FoldPick, FoldPickIndex } from '../../canvas/foldPicking';
import type { FoldToolState } from '../foldToolState';
import {
  landingFourths,
  middleOf,
  swivelDirectionsOf,
  swivelFoldPick,
  swivelKindsLanding,
  vertexChosenOp,
  type FoldVertexTaken,
} from './vertexStep';

/** A line offered, by Fold's edge id, and a sheet point inside it: what names it to the engine. */
export interface FoldSwivelReachLine {
  id: number;
  at: SheetPoint;
}

/** What is asked: where the creases meet, the folder's way, the edges a click can take and the lines they may land on. */
export interface FoldSwivelReachAsk {
  /** A pivot through every layer, or a point on a folded edge (`FoldSwivelOnFoldOp`'s `fold`). */
  at: { pivot: SheetPoint } | { fold: SheetPoint };
  /** The way the folder would fold it, when it lands that way. */
  direction: FoldDirection;
  /**
   * On a folded edge, the kind preferred where it lands: open when absent,
   * as the canvas asks it, since a kind is chosen only once the swivel is
   * previewed.
   */
  kind?: FoldSwivelKind;
  /** The raw and folded edges a click can take. */
  edges: readonly FoldSwivelReachLine[];
  /** Every line a click can take as the target. */
  targets: readonly FoldSwivelReachLine[];
}

/** A swivel that lands some way: an edge and the line it lands on, by id, as it will be folded. */
export interface FoldSwivelLanding {
  edge: number;
  target: number;
  /** Valley, then mountain, as the viewer sees them: whether it lands that way, of the kind it will be folded. */
  directions: readonly [boolean, boolean];
  /** On a folded edge, open then inside: whether it lands that kind either way. Absent at a free vertex. */
  kinds?: readonly [boolean, boolean];
  /** The op as it will be folded: the folder's way and kind on a folded edge, and its ridge (`vertexChosenOp`). */
  op: FoldVertexOp;
  /** What the engine said of that op: what its preview draws. */
  answer: FoldVertexAnalysed;
}

export interface FoldSwivelReach {
  /** Every pair that lands, edges in the order asked, each edge's targets in the order asked. */
  landings: FoldSwivelLanding[];
}

/** The compound question, for one op on the state asked about. */
export type FoldSwivelAsk = (op: FoldVertexOp) => FoldEngineOutcome<FoldCompoundAnalysis>;

/** No choice made yet: the first ridge that lands. */
const UNCHOSEN: FoldVertexTaken = { squashTarget: null, emergent: null, order: 0 };

const OTHER: Readonly<Record<FoldDirection, FoldDirection>> = { valley: 'mountain', mountain: 'valley' };

function vertexAnswer(reply: FoldEngineOutcome<FoldCompoundAnalysis>): FoldVertexAnalysed | null {
  return reply.status === 'ok' && reply.family === 'vertex' && reply.analysis.kind === 'swivel-by-edge' ? reply : null;
}

/** One way of one pair, described: as it will be folded, whether or not it lands. */
function describedOf(ask: FoldSwivelAsk, op: FoldVertexOp): { op: FoldVertexOp; answer: FoldVertexAnalysed; first: FoldVertexAnalysed } | null {
  const first = vertexAnswer(ask(op));
  if (!first) return null;
  const chosen = vertexChosenOp(op, first, UNCHOSEN);
  if (!chosen) return null;
  const answer = chosen.again ? vertexAnswer(ask(chosen.op)) : first;
  return answer ? { op: chosen.op, answer, first } : null;
}

/** Every pair asked, what lands some way kept (see the module docs). */
export function swivelReach(ask: FoldSwivelAsk, request: FoldSwivelReachAsk): FoldSwivelReach {
  const { at, direction, kind = 'open', edges, targets } = request;
  const landings: FoldSwivelLanding[] = [];
  for (const edge of edges) {
    for (const target of targets) {
      if (target.id === edge.id) continue;
      const base = { kind: 'swivel', via: 'edge', edge: edge.at, target: { via: 'crease', at: target.at } } as const;
      if ('fold' in at) {
        // On a folded edge the answer says which kinds and ways land.
        const described = describedOf(ask, withSwivelKind({ ...base, fold: at.fold, direction }, kind));
        const ways = described ? swivelDirectionsOf(described.first, kind, kind) : null;
        const kinds = described ? swivelKindsLanding(described.first) : null;
        if (described && (kinds ?? ways)?.some(Boolean)) {
          landings.push({
            edge: edge.id,
            target: target.id,
            directions: [ways?.[0] === true, ways?.[1] === true],
            ...(kinds ? { kinds } : {}),
            op: described.op,
            answer: described.answer,
          });
        }
        continue;
      }
      // At a free vertex each way is its own fold, asked on its own.
      const op = (way: FoldDirection): FoldVertexOp => ({ ...base, pivot: at.pivot, seed: { scope: 'all' }, direction: way });
      const preferred = describedOf(ask, op(direction));
      const other = describedOf(ask, op(OTHER[direction]));
      const lands = (way: typeof preferred) => way !== null && landingFourths(way.answer).length > 0;
      if (!lands(preferred) && !lands(other)) continue;
      // Drawn as the folder's way when it describes; the other's picture only stands in for its geometry.
      const shown = preferred ?? other;
      if (!shown) continue;
      landings.push({
        edge: edge.id,
        target: target.id,
        directions: direction === 'valley' ? [lands(preferred), lands(other)] : [lands(other), lands(preferred)],
        op: preferred?.op ?? op(direction),
        answer: shown.answer,
      });
    }
  }
  return { landings };
}

// ---------------------------------------------------------------------------
// What the canvas asks, and how it reads the answer

/**
 * What a swivel's clicks so far ask: where its creases meet — a pivot, or a
 * point on the folded edge it was clicked on — and every raw or folded edge
 * and every line either pane offers, each once by its edge id. Null before
 * the meeting point, and for a target named by two points: any line can be
 * drawn through them, so there is no set of lines to offer.
 */
export function swivelReachAsk(
  index: FoldPickIndex,
  tools: Pick<FoldToolState, 'tool' | 'swivelTarget' | 'picks' | 'vertexDirection'>
): FoldSwivelReachAsk | null {
  const meet = tools.tool === 'swivel' && tools.swivelTarget === 'crease' ? tools.picks[0] : undefined;
  if (meet?.kind !== 'point') return null;
  const edges = new Map<number, FoldSwivelReachLine>();
  const targets = new Map<number, FoldSwivelReachLine>();
  for (const segment of [...index.folded.segments, ...index.creasePattern.segments]) {
    // This reach catalog resolves physical edges by midpoint. Crease marks
    // instead locate a line by their stretch (the normal Locate line path).
    if (segment.creaseMark) continue;
    if (targets.has(segment.edge)) continue;
    const line = { id: segment.edge, at: middleOf(segment) };
    targets.set(segment.edge, line);
    if (segment.segment === 'raw_edge' || segment.segment === 'bend') edges.set(segment.edge, line);
  }
  return {
    at: swivelFoldPick(tools) ? { fold: meet.sheet } : { pivot: meet.sheet },
    direction: tools.vertexDirection,
    edges: [...edges.values()],
    targets: [...targets.values()],
  };
}

/** A swivel's reach, as the canvas and the window read it. */
export interface FoldSwivelReachView {
  /** Asked, and not answered yet: nothing is offered meanwhile. */
  status: 'asking' | 'ready';
  /** The edges that can swing onto some line, by edge id. */
  edges: ReadonlySet<number>;
  /** Per edge that can swing, the lines it lands on, by edge id, each as it will be folded. */
  targets: ReadonlyMap<number, ReadonlyMap<number, FoldSwivelLanding>>;
}

export const SWIVEL_REACH_ASKING: FoldSwivelReachView = { status: 'asking', edges: new Set(), targets: new Map() };

export function swivelReachView(reach: FoldSwivelReach): FoldSwivelReachView {
  const targets = new Map<number, Map<number, FoldSwivelLanding>>();
  for (const landing of reach.landings) {
    let lines = targets.get(landing.edge);
    if (!lines) {
      lines = new Map();
      targets.set(landing.edge, lines);
    }
    lines.set(landing.target, landing);
  }
  return { status: 'ready', edges: new Set(targets.keys()), targets };
}

/** Nothing can swing from where the creases meet: the window says so, and a click picks another point. */
export function swivelReachesNothing(reach: FoldSwivelReachView | null): boolean {
  return reach?.status === 'ready' && reach.edges.size === 0;
}

/**
 * Which lines a swivel's next click is offered, by edge id: at its second
 * click the edges that can swing, at its third the lines the edge picked
 * lands on — none while the worker is asked. Null when its reach decides
 * nothing: before the meeting point, after the target, or for a target named
 * by two points.
 */
export function swivelOffered(
  reach: FoldSwivelReachView | null,
  picks: readonly FoldPick[]
): ((edge: number) => boolean) | null {
  if (!reach) return null;
  if (picks.length === 1) return (edge) => reach.edges.has(edge);
  const picked = picks.length === 2 ? picks[1] : undefined;
  if (picked?.kind !== 'segment') return null;
  const lines = reach.targets.get(picked.edge);
  return (target) => lines?.has(target) === true;
}

/** The swivel an edge and a line make, as it will be folded, when they land; null otherwise, or while asking. */
export function swivelLanding(
  reach: FoldSwivelReachView | null,
  edge: number | null,
  target: number | null
): FoldSwivelLanding | null {
  if (!reach || edge === null || target === null) return null;
  return reach.targets.get(edge)?.get(target) ?? null;
}

/** Two model lines that are one line: their unit normals and offsets agree, either way round. */
function sameModelLine(a: FoldModelLine, b: FoldModelLine): boolean {
  const close = (sign: 1 | -1) =>
    Math.abs(a.n[0] - sign * b.n[0]) < SAME_LINE && Math.abs(a.n[1] - sign * b.n[1]) < SAME_LINE && Math.abs(a.d - sign * b.d) < SAME_LINE;
  return close(1) || close(-1);
}

const SAME_LINE = 1e-7;

/**
 * The swivel an edge makes when the line it lands on is implied: every line
 * it lands on is one line of the folded form — the same crease through
 * several layers, say — so pointing at the edge says the whole swivel. Null
 * when it lands on lines that differ, or on none.
 */
export function swivelImpliedLanding(reach: FoldSwivelReachView | null, edge: number): FoldSwivelLanding | null {
  const lines = reach?.targets.get(edge);
  if (!lines) return null;
  let first: FoldSwivelLanding | null = null;
  for (const landing of lines.values()) {
    const { analysis } = landing.answer;
    if (analysis.kind !== 'swivel-by-edge') return null;
    if (!first) first = landing;
    else if (first.answer.analysis.kind !== 'swivel-by-edge' || !sameModelLine(first.answer.analysis.target, analysis.target)) {
      return null;
    }
  }
  return first;
}

/** The landing the swivel's clicks name, once its edge and target are clicked as lines. */
export function swivelPickedLanding(reach: FoldSwivelReachView | null, picks: readonly FoldPick[]): FoldSwivelLanding | null {
  const [, edge, target] = picks;
  return swivelLanding(reach, edge?.kind === 'segment' ? edge.edge : null, target?.kind === 'segment' ? target.edge : null);
}
