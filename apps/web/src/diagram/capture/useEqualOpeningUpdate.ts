import { useMemo } from 'react';
import { equalOpeningAmount } from '../../layer-spread/equalOpening';
import type { ConnectedSpreadView } from '../../layer-spread/view';
import type { DiagramCpRender } from '../document/diagramDocument';

/**
 * Update, for a Default spread saved in Perspective 3D before equal opening
 * (version 1, `implementation-plans/spread-equal-opening.md`): run, it makes
 * the spread version 2 at the amount that draws the picture as it is, capped
 * at 100%; held while a capture runs, or until the live view's solve, which
 * that amount is measured from, is ready.
 */
export interface EqualOpeningUpdate {
  run: () => void;
  disabled: boolean;
}

/** What keeps a step from being posed: for as long as the diagram is open (`blocked`), or while a capture runs (`busy`). */
export interface EqualOpeningHolds {
  /** A read-only diagram, or marks a newer build made: waiting never enables Update. */
  blocked: boolean;
  busy: boolean;
}

/**
 * A step pose's Update (`EqualOpeningUpdate`), or null while its render is not
 * a version 1 Default spread in Perspective 3D, or while the step is
 * `blocked`, where no Update is offered rather than one that never enables.
 * `apply` poses the step with the `spread-equal-opening` edit at the amount
 * given, as one undo step.
 */
export function useEqualOpeningUpdate(
  render: DiagramCpRender | null | undefined,
  connected: ConnectedSpreadView | null,
  { blocked, busy }: EqualOpeningHolds,
  apply: (amount: number) => unknown,
): EqualOpeningUpdate | null {
  const spread =
    !blocked && render?.mode === 'folded-flat' && render.presentation?.kind === 'perspective' &&
    render.spread?.kind === 'connected' && render.spread.version === 1
      ? render.spread
      : null;
  const prepared = connected?.prepared ?? null;
  return useMemo(() => {
    if (!spread) return null;
    return {
      disabled: busy || !prepared,
      run: () => {
        if (!busy && prepared) apply(equalOpeningAmount(spread, prepared));
      },
    };
  }, [spread, prepared, busy, apply]);
}
