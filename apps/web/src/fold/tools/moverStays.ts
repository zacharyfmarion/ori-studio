/**
 * A fold refused because the point it carries would stay put (`mover_stays`):
 * the sheet point named is on paper that does not fold, though paper that
 * does may lie at the same spot — a flap's corner over the layer it lies on,
 * with that layer showing past it. Its fix is the same step with that point
 * swapped for another sheet point at the spot, the paper on top first, and
 * only one the engine lands is offered.
 *
 * React-free and store-free.
 */
import type { FoldOp, FoldRef, SheetPoint } from '../document/foldSequenceDocument';
import type { FoldRefused } from './refusalNotice';

/** The most points at the spot asked of the engine for one refusal: the layers nearest the top. */
export const MOVER_FIX_TRIES = 6;

/** A point a step names, the same as one the engine reports: what a stored sheet point round-trips to. */
const SAME = 1e-9;

const samePoint = (a: SheetPoint, b: SheetPoint) => Math.abs(a[0] - b[0]) <= SAME && Math.abs(a[1] - b[1]) <= SAME;

/** The sheet point a `mover_stays` refusal says stays put (the engine's `point`); null for any other refusal. */
export function moverStaysPoint(refused: FoldRefused | null): SheetPoint | null {
  const refusal = refused?.refusal;
  if (refusal?.code !== 'mover_stays') return null;
  const { point } = refusal;
  return Array.isArray(point) && point.length === 2 && point.every((value) => typeof value === 'number' && Number.isFinite(value))
    ? [point[0] as number, point[1] as number]
    : null;
}

/**
 * `op` with its axiom's point at `from` named by `to` instead; null when its
 * line is no axiom, or names no point at `from`. A Divide-line mark swapped
 * is a plain point: the mark is on the other layer.
 */
export function withMoverSwapped(op: FoldOp, from: SheetPoint, to: SheetPoint): FoldOp | null {
  if (!('line' in op) || op.line.via !== 'axiom') return null;
  let swapped = false;
  const inputs = op.line.inputs.map((ref): FoldRef => {
    if (ref.kind === 'edge' || !samePoint(ref.at, from)) return ref;
    swapped = true;
    return { kind: 'point', at: to };
  });
  return swapped ? ({ ...op, line: { ...op.line, inputs } } as FoldOp) : null;
}

/** A refused fold's point, and the one at the same spot that lands it. */
export interface FoldMoverFix {
  from: SheetPoint;
  to: SheetPoint;
  op: FoldOp;
}

/**
 * The first of `together` — the sheet points at the refused point's spot,
 * the paper on top first (`sheetPointsTogether`) — whose step `lands`, of
 * the first {@link MOVER_FIX_TRIES}; null when none does, or the refusal is
 * another.
 */
export async function findMoverFix(
  op: FoldOp,
  refused: FoldRefused | null,
  together: (point: SheetPoint) => readonly SheetPoint[],
  lands: (op: FoldOp) => Promise<boolean>
): Promise<FoldMoverFix | null> {
  const from = moverStaysPoint(refused);
  if (!from) return null;
  for (const to of together(from).slice(0, MOVER_FIX_TRIES)) {
    const swapped = withMoverSwapped(op, from, to);
    if (!swapped) return null;
    if (await lands(swapped)) return { from, to, op: swapped };
  }
  return null;
}
