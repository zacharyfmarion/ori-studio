import { useMemo } from 'react';
import type { ConnectedSpreadView } from '../../layer-spread/view';
import { spreadUpdate } from '../../layer-spread/spreadUpdate';
import type { DiagramCpRender } from '../document/diagramDocument';

export interface EqualOpeningUpdate {
  run: () => void;
  disabled: boolean;
  capped?: boolean;
}

export interface EqualOpeningHolds {
  blocked: boolean;
  busy: boolean;
}

/** The explicit, undoable Update of a saved step, measured in its active view. */
export function useEqualOpeningUpdate(
  render: DiagramCpRender | null | undefined,
  connected: ConnectedSpreadView | null,
  { blocked, busy }: EqualOpeningHolds,
  apply: (amount: number) => unknown,
  spatialGain: number | null = null,
): EqualOpeningUpdate | null {
  const spread = render?.mode === 'folded-flat' || render?.mode === 'folded-3d' ? render.spread : null;
  const perspective = render?.mode === 'folded-flat' && render.presentation?.kind === 'perspective';
  const prepared = connected?.prepared ?? null;
  return useMemo(() => {
    if (blocked || !spread || (spread.kind !== 'connected' && spread.kind !== 'spatial')) return null;
    if (spread.kind === 'connected' ? spread.version === 3 : spread.version === 2) return null;
    const update = spreadUpdate(spread, perspective, prepared, spatialGain);
    return {
      disabled: busy || update === null,
      capped: update?.capped,
      run: () => { if (!busy && update) apply(update.amount); },
    };
  }, [spread, perspective, prepared, spatialGain, busy, blocked, apply]);
}
