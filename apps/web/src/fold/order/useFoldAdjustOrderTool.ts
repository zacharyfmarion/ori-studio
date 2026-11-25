import { useCallback, useEffect, useRef, useState } from 'react';
import { trackFoldStepAdded } from '../../analytics';
import { openLayerOrderDialog } from '../../layer-order/dialog/layerOrderDialogGateway';
import { reportError } from '../../monitoring';
import { foldSession } from '../../store/workspaceStore/foldSession';
import { useWorkspaceStore } from '../../store/workspaceStore/store';
import type { FoldAdjustOrderOpening } from '../engine/foldEngineIoWire';
import type { FoldEngineOutcome } from '../engine/foldEngineWire';
import { foldImportView } from '../io/foldImportLayerOrder';
import type { FoldSessionSurface } from '../session/useFoldSession';
import { foldTools, type FoldToolState } from '../tools/foldToolState';
import { foldAdjustOrderChosen, foldAdjustOrderRequest } from './adjustOrderRequest';
import type { FoldAdjustOrderUnavailable, FoldAdjustOrderWindowView } from './adjustOrderToolWindow';

/** Adjust order while it is in hand: what its window shows, and its one verb. */
export interface FoldAdjustOrderTool {
  view: FoldAdjustOrderWindowView;
  /** Open the Layer order dialog on the step on screen; whether it could. Its Apply adds the step. */
  open: () => boolean;
}

/** The engine's refusal reason for the 3D case: Edit's fold of creases that do not fold flat. */
const NEEDS_3D = 'fold_needs_3d';

/** Why an opening refused, as the window says it. */
function unavailableOf(outcome: FoldEngineOutcome<FoldAdjustOrderOpening>): FoldAdjustOrderUnavailable | null {
  if (outcome.status === 'ok') return null;
  const reason = (outcome.refusal as { readonly reason?: unknown }).reason;
  return reason === NEEDS_3D ? 'not_flat' : 'unreadable';
}

/**
 * Adjust order, the tool (`implementation-plans/fold-adjust-order.md`):
 * while it is in hand, the engine opens the step on screen onto the Layer
 * order dialog's faces (`adjustOrderOpening`), so the window knows whether
 * its button can open the dialog before it is pressed. The button opens the
 * dialog through its gateway on that opening, with no Rotate; Apply's
 * relations are landed by the engine as an `adjust-order` step after the
 * step on screen, committed as landed (`commitLanded`, so nothing is folded
 * twice), and the tool is put down. Cancel, or an Apply that changed
 * nothing, adds nothing and keeps the tool in hand. Its turn and its side are
 * never read.
 *
 * Null while another tool is in hand.
 */
export function useFoldAdjustOrderTool(session: FoldSessionSurface, tools: FoldToolState): FoldAdjustOrderTool | null {
  const active = tools.tool === 'adjust-order';
  const handle = active ? session.cursor.state : null;
  const atSheet = session.cursorId === null;
  const key = handle ? `${handle.generation}:${handle.id}` : null;
  const { withState } = session;

  // --- The opening of the step on screen, asked once per state while the tool is in hand.
  const [opening, setOpening] = useState<{ key: string; outcome: FoldEngineOutcome<FoldAdjustOrderOpening> | null } | null>(null);
  useEffect(() => {
    if (!active || !handle || key === null || atSheet) return undefined;
    let current = true;
    void withState(handle, (engine, state) => engine.adjustOrderOpening(state)).then(
      (answer) => {
        if (current) setOpening({ key, outcome: answer.status === 'answered' ? answer.value : null });
      },
      (error: unknown) => {
        reportError(error, { surface: 'fold:adjust-order-opening' });
        if (current) setOpening({ key, outcome: null });
      }
    );
    return () => {
      current = false;
    };
    // The handle is read through its key: an equal state must not ask again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, key, atSheet, withState]);
  const asked = opening && opening.key === key ? opening : null;

  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const asking = useRef<AbortController | null>(null);
  // The dialog never outlives the tool: putting it down, or leaving Fold, withdraws it.
  useEffect(() => {
    if (active) return undefined;
    asking.current?.abort();
    return undefined;
  }, [active]);
  useEffect(() => () => asking.current?.abort(), []);

  const ready = asked?.outcome?.status === 'ok' ? asked.outcome : null;
  const unavailable: FoldAdjustOrderUnavailable | null = atSheet
    ? 'sheet'
    : asked?.outcome === null
      ? 'unreadable'
      : asked?.outcome
        ? unavailableOf(asked.outcome)
        : null;

  const open = useCallback((): boolean => {
    if (!active || !handle || !ready || busy || session.readOnly || asking.current) return false;
    const parent = handle;
    const asked = new AbortController();
    asking.current = asked;
    setBusy(true);
    setFailed(null);
    void (async () => {
      try {
        const request = foldAdjustOrderRequest(ready, foldImportView(useWorkspaceStore.getState()));
        const chosen = foldAdjustOrderChosen(await openLayerOrderDialog(request, { signal: asked.signal }));
        // Cancel, an Apply that changed nothing, or the tool put down under the dialog: no step.
        if (!chosen || asked.signal.aborted) return;
        const fold = foldSession();
        const picked = await fold.withState(parent, (engine, state) =>
          engine.adjustOrderPick(state, chosen.digest, chosen.relations)
        );
        if (picked.status !== 'answered' || picked.value.status !== 'ok') {
          setFailed(key);
          return;
        }
        const landed = picked.value;
        const committed = await fold.commitLanded({
          state: { generation: parent.generation, id: landed.state },
          parent,
          op: landed.op,
          fingerprint: landed.fingerprint,
          summary: landed.summary,
        });
        if (committed.status === 'committed') {
          trackFoldStepAdded('adjust_order');
          foldTools().putDown();
        } else {
          setFailed(key);
        }
      } catch (error) {
        reportError(error, { surface: 'fold:adjust-order-commit' });
        setFailed(key);
      } finally {
        if (asking.current === asked) asking.current = null;
        setBusy(false);
      }
    })();
    return true;
  }, [active, handle, ready, busy, session.readOnly, key]);

  if (!active) return null;
  return {
    view: {
      unavailable,
      checking: !atSheet && asked === null,
      busy,
      failed: failed !== null && failed === key,
    },
    open,
  };
}
