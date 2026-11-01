import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { LayerOrderDialogOpening } from '../../layer-order/dialog/layerOrderDialogStore';
import { requestFaceLetters } from '../../layer-order/dialog/layerOrderSession';
import { lettersHidden, useLayerOrderDialog } from '../../layer-order/dialog/useLayerOrderDialog';
import { useLayerOrderSession } from '../../layer-order/dialog/useLayerOrderSession';
import { useLayerOrderSettle } from '../../layer-order/dialog/useLayerOrderSettle';
import { applyState, openNotice } from '../../layer-order/model/layerOrderSelectors';
import { useModalFullScreen } from '../ui/ModalFrame';
import { LayerOrderDialogFrame, type LayerOrderPhonePane } from './LayerOrderDialogFrame';
import { layerOrderCopy } from './layerOrderInspectorCopy';
import { LayerOrderInspector } from './LayerOrderInspector';
import { applyRefoldsText, applyWaitText } from './layerOrderNotices';
import { LayerOrderPanes } from './LayerOrderPanes';
import { LayerOrderViewTools } from './LayerOrderViewTools';

/**
 * The Layer order dialog: the entry of its lazy chunk, which only its gateway
 * imports (`layer-order/dialog/layerOrderDialogGateway.ts`) and the app
 * root's mount renders (`LayerOrderDialogMount`). A composition site, as a
 * panel is (AGENTS.md): the session and its engine worker
 * (`useLayerOrderSession`), the ways out (`useLayerOrderSettle`), the
 * inspector's model bound to both (`useLayerOrderDialog`), and the frame with
 * its two regions, the panes (U8) and the inspector (U10), and its history.
 *
 * Mounted once per opening (keyed by its id), so every opening starts fresh
 * with a worker of its own, terminated as it closes.
 */
export function LayerOrderDialog({ opening }: { opening: LayerOrderDialogOpening }) {
  const { t, i18n } = useTranslation();
  const { request } = opening;
  const session = useLayerOrderSession(request);
  const settle = useLayerOrderSettle(opening, session);
  const dialog = useLayerOrderDialog(opening, session, settle);
  const fullScreen = useModalFullScreen();
  const [pane, setPane] = useState<LayerOrderPhonePane>('folded');
  const phonePane = fullScreen ? pane : null;
  const { status, state } = dialog;
  const shownLetters = useMemo(() => requestFaceLetters(request), [request]);
  const letters = session.status.kind === 'ready' ? session.status.open.letters : shownLetters;
  const copy = useMemo(
    () => layerOrderCopy(t, i18n.language, letters, request.surface ?? null),
    [t, i18n.language, letters, request.surface]
  );
  const apply = applyState(state);
  const notice = openNotice(state);
  // A tinted face with no letter at this zoom on any pane in view (D7's addition).
  const hidden = lettersHidden(dialog.unlettered, phonePane === null ? null : phonePane === 'crease' ? 'pattern' : 'folded');

  return (
    <LayerOrderDialogFrame
      name={request.name}
      byline={request.byline}
      status={status}
      letters={letters}
      returnFocus={opening.returnFocus}
      phonePane={phonePane}
      onPhonePaneChange={setPane}
      tools={<LayerOrderViewTools view={dialog.view} onChange={dialog.setView} disabled={status.kind !== 'ready'} />}
      panes={
        <LayerOrderPanes
          status={status}
          phonePane={phonePane}
          request={request}
          letters={letters}
          view={dialog.view}
          marks={dialog.marks}
          stacks={dialog.stacks}
          {...dialog.events}
          onUnlettered={dialog.onUnlettered}
        />
      }
      inspector={
        <LayerOrderInspector
          state={state}
          dispatch={dialog.dispatch}
          copy={copy}
          letters={letters}
          hint={{ unlettered: hidden }}
        />
      }
      history={dialog.history}
      onRetry={dialog.retry}
      onCancel={dialog.cancel}
      onApply={dialog.apply}
      applyWaits={apply.enabled ? null : applyWaitText(t, apply.why)}
      applying={settle.applying}
      applyRefusal={settle.applyRefusal}
      // D19's notice of how the record opened, else D12's: opened on creases that
      // changed since the host's fold, its Apply refolds too.
      note={
        notice
          ? { text: copy.openNotice(notice), onHover: dialog.setNoticeLit }
          : request.applyRefolds
            ? { text: applyRefoldsText(t, request.name) }
            : null
      }
    />
  );
}
