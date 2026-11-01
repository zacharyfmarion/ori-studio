/**
 * How far each spread figure's picture reaches from its pivot, for the chrome
 * that surrounds it: the box and its handles, the floating toolbar's anchor,
 * the hit area and Fit (`foldedFigureBox`).
 *
 * A spread figure is drawn from its paper scene with its layers moved apart,
 * so it can reach past its flat picture — the box the chrome has always been
 * cut from. The box grows to take the spread in, about the same pivot, so a
 * turn or a resize of a spread figure behaves as one of a flat figure does and
 * a figure never moves when its spread changes (`foldedFigureSpreadFrame.ts`).
 *
 * The drawing side (`useFoldedFlatSpread`) writes a figure's reach once its
 * spread picture is drawn and no edit is in the middle of a gesture, and
 * forgets it when the figure stops drawing spread. So the chrome keeps still
 * while a slider or a drag is moving the picture, and settles when it ends.
 * Each reach remembers the fold it was measured on, and answers for no other:
 * a figure folded again is flat until its new picture is measured. A write of
 * the figure's colours replaces its snapshot and keeps its fold, so its reach
 * answers on (`sameFoldedPaperScene`).
 *
 * Runtime state only: never saved, never in history. An external store; the
 * table is replaced, never mutated, and its version is what memos over boxes
 * depend on.
 */

import { useSyncExternalStore } from 'react';
import type {
  OristudioCpFoldedFigureEntry,
  OristudioCpFoldedFigureSnapshot,
} from '../../engine/oristudioCpTypes';
import { sameFoldedPaperScene } from './foldedFlatSpreadScene';

export interface FoldedFigureSpreadReach {
  /** The fold the reach was measured on (the figure's kernel snapshot). */
  readonly snapshot: OristudioCpFoldedFigureSnapshot;
  /** The figure's kernel handle then, if it had one. */
  readonly handle?: number | null;
  /** Along the figure's own axes from its pivot, before its scale: local user units. */
  readonly halfWidth: number;
  readonly halfHeight: number;
}

let reaches: ReadonlyMap<string, FoldedFigureSpreadReach> = new Map();
let version = 0;
const listeners = new Set<() => void>();

function publish(next: ReadonlyMap<string, FoldedFigureSpreadReach>): void {
  reaches = next;
  version += 1;
  for (const listener of listeners) listener();
}

/** Record a figure's reach, or forget it with `null`. One that stands already changes nothing. */
export function setFoldedFigureSpreadReach(id: string, reach: FoldedFigureSpreadReach | null): void {
  const held = reaches.get(id) ?? null;
  if (held === reach) return;
  if (
    held &&
    reach &&
    measuredOn(held, reach) &&
    held.halfWidth === reach.halfWidth &&
    held.halfHeight === reach.halfHeight
  )
    return;
  const next = new Map(reaches);
  if (reach) next.set(id, reach);
  else next.delete(id);
  publish(next);
}

/** The reach measured on this figure's current fold, or null when there is none. */
export function foldedFigureSpreadReach(
  figure: Partial<Pick<OristudioCpFoldedFigureEntry, 'id' | 'handle' | 'snapshot'>>
): FoldedFigureSpreadReach | null {
  if (figure.id === undefined || !figure.snapshot) return null;
  const reach = reaches.get(figure.id);
  return reach && measuredOn(reach, { handle: figure.handle, snapshot: figure.snapshot }) ? reach : null;
}

/**
 * Whether the reach was measured on this fold: on this very snapshot, or on
 * one of the same handle that shows the same paper scene.
 */
function measuredOn(
  reach: FoldedFigureSpreadReach,
  fold: Pick<FoldedFigureSpreadReach, 'handle' | 'snapshot'>
): boolean {
  if (reach.snapshot === fold.snapshot) return true;
  // Handle 0 is a valid wasm slot index; only null/undefined means "not ready".
  return fold.handle != null && reach.handle === fold.handle && sameFoldedPaperScene(reach.snapshot, fold.snapshot);
}

/** The figures with a reach recorded. For the drawing side, which forgets the ones that went. */
export function foldedFigureSpreadReachIds(): readonly string[] {
  return [...reaches.keys()];
}

export function subscribeFoldedFigureSpreadReach(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Changes whenever a reach does: what a memo over figure boxes depends on. */
export function foldedFigureSpreadReachVersion(): number {
  return version;
}

/** {@link foldedFigureSpreadReachVersion} as a hook. */
export function useFoldedFigureSpreadReachVersion(): number {
  return useSyncExternalStore(
    subscribeFoldedFigureSpreadReach,
    foldedFigureSpreadReachVersion,
    foldedFigureSpreadReachVersion
  );
}

/** Forget every reach. For closing a document, and for test isolation. */
export function resetFoldedFigureSpreadReach(): void {
  if (reaches.size === 0) return;
  publish(new Map());
}
