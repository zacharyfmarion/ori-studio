/**
 * The Layer order dialog's two ways out, bound to its session and its host's
 * waiting promise (`implementation-plans/layer-order-dialog.md`, rows U4 and
 * U10): Cancel (and the close button and Escape) and Apply.
 *
 * - **Cancel** answers `cancelled`. The dialog goes as the opening settles,
 *   and its worker with it (`useLayerOrderSession`), mid-call or not: the
 *   Opening frame's Cancel included.
 * - **Apply** carries out what the inspector's model decided (its `apply`
 *   effect, `LayerOrderApplyResult`), and decides nothing itself: D16 is the
 *   model's alone, against the baseline it keeps across every open and
 *   restore, Keep trying's included. Nothing changed answers `unchanged` with
 *   no save, and the host writes nothing. Otherwise it saves through the
 *   engine, writing back the carried rows the model still lists, and answers
 *   `applied` with the record and relations for the host to fold
 *   (`applyLayerOrderSession`). The save changes nothing in the session, so a
 *   save the engine refuses (a record over its budget) keeps the dialog open
 *   with the reason, as it was.
 */
import { useCallback, useState } from 'react';
import type { LayerRefusal } from '../engine/layerOrderEngine';
import type { LayerOrderApplyResult } from '../model/layerOrderState';
import { settleLayerOrderDialog, type LayerOrderDialogOpening } from './layerOrderDialogStore';
import type { LayerOrderSession } from './useLayerOrderSession';

/**
 * How an Apply went: the dialog is answered with a record (`applied`) or with
 * nothing to write (`unchanged`), the save refused it and the dialog stays
 * open with the reason (`refused`), or it did nothing (`skipped`: already
 * applying, no session, or the engine went away).
 */
export type LayerOrderApplyOutcome = 'applied' | 'unchanged' | 'refused' | 'skipped';

export interface LayerOrderSettle {
  readonly cancel: () => void;
  /** Apply what the model decided Apply writes, and the turn it hands back, if any. Resolves how it went. */
  readonly apply: (result: LayerOrderApplyResult, turnDeg?: number | null) => Promise<LayerOrderApplyOutcome>;
  /** An Apply is saving: Apply waits, Cancel still closes. */
  readonly applying: boolean;
  /** Why the last Apply could not save, until the next. */
  readonly applyRefusal: LayerRefusal | null;
}

export function useLayerOrderSettle(opening: LayerOrderDialogOpening, session: LayerOrderSession): LayerOrderSettle {
  const [applying, setApplying] = useState(false);
  const [applyRefusal, setApplyRefusal] = useState<LayerRefusal | null>(null);
  const { id } = opening;
  const { status, apply: save } = session;

  const cancel = useCallback(() => {
    settleLayerOrderDialog(id, { kind: 'cancelled' });
  }, [id]);

  const apply = useCallback(
    async (result: LayerOrderApplyResult, turnDeg: number | null = null): Promise<LayerOrderApplyOutcome> => {
      if (applying || status.kind !== 'ready') return 'skipped';
      const turn = turnDeg === null ? {} : { turnDeg };
      if (result.kind === 'no_change') {
        settleLayerOrderDialog(id, { kind: 'unchanged', ...turn });
        return 'unchanged';
      }
      setApplying(true);
      setApplyRefusal(null);
      const answer = await save(result.keepCarried);
      setApplying(false);
      // No session, or it went away while saving: the session's status says which.
      if (!answer) return 'skipped';
      if (answer.kind === 'refused') {
        setApplyRefusal(answer.refusal);
        return 'refused';
      }
      settleLayerOrderDialog(id, { kind: 'applied', applied: answer.applied, ...turn });
      return 'applied';
    },
    [applying, id, save, status]
  );

  return { cancel, apply, applying, applyRefusal };
}
