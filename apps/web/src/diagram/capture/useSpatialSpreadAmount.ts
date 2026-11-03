import { useMemo, useRef, useState } from 'react';
import type { DiagramCpRender } from '../document/diagramDocument';
import type { PoseController } from './poseController';

export interface SpatialSpreadAmount {
  amount: number;
  disabled: boolean;
  preview: (amount: number) => void;
  commit: () => void;
}

/** A slider gesture changes only the live amount; release captures once through
 * the existing pose controller, so undo and stale-source checks stay shared. */
export function useSpatialSpreadAmount(
  key: string | null,
  render: DiagramCpRender | null,
  controller: PoseController | null,
  disabled: boolean
): SpatialSpreadAmount | null {
  const stored = render?.mode === 'folded-3d' ? render.spread : undefined;
  const [previewed, setPreviewed] = useState<{
    key: string | null;
    stored: typeof stored;
    amount: number;
  } | null>(null);
  const current = useRef(previewed);
  return useMemo(
    () =>
      stored && controller
        ? {
            amount:
              previewed?.key === key && previewed.stored === stored
                ? previewed.amount
                : stored.amount,
            disabled,
            preview: (amount: number) => {
              if (disabled || !Number.isFinite(amount)) return;
              const next = {
                key,
                stored,
                amount: Math.max(0, Math.min(2, amount)),
              };
              current.current = next;
              setPreviewed(next);
            },
            commit: () => {
              const pending = current.current;
              if (disabled || pending?.key !== key || pending.stored !== stored)
                return;
              void controller
                .run({ verb: 'spread-amount', amount: pending.amount })
                .finally(() => {
                  if (current.current === pending) {
                    current.current = null;
                    setPreviewed(null);
                  }
                });
            },
          }
        : null,
    [key, stored, controller, disabled, previewed]
  );
}
