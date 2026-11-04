import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { CircleAlert, Info } from 'lucide-react';
import type { ModalHistory } from '../../keyboard/dialogShortcuts';
import type { FaceLetters } from '../../layer-order/engine/faceIndex';
import type { LayerRefusal } from '../../layer-order/engine/layerOrderEngine';
import { useLayerOrderLongOpen } from '../../layer-order/dialog/useLayerOrderLongOpen';
import type { LayerOrderSessionStatus } from '../../layer-order/dialog/useLayerOrderSession';
import type { LayerPanesEvents } from '../../layer-order/panes/layerPaneInput';
import type { LayerFaceMarks, LayerPanesStacks, LayerPanesView } from '../../layer-order/panes/layerPaneMarks';
import type { LayerOrderRequest } from '../../lib/layerOrder/layerOrderRequest';
import { Button } from '../ui/Button';
import { ModalFrame } from '../ui/ModalFrame';
import { Notice } from '../ui/Notice';
import { SegmentedControl } from '../ui/SegmentedControl';
import { applyRefusalText, applyWaitText, sessionNotice } from './layerOrderNotices';
import styles from './LayerOrderDialogFrame.module.css';

/** The one pane a phone-width dialog shows at a time (D6). */
export type LayerOrderPhonePane = 'folded' | 'crease';

/**
 * What the panes region is told: the contract `LayerOrderPanes` takes (U8).
 *
 * - `opening`: the crease pattern draws at once, from the request's source;
 *   the folded figure's place waits (PictureLoading).
 * - `ready`: both draw, from `status.open`.
 * - `refused`, `lost`: the crease pattern only. The frame gives the region
 *   the crease pattern's column and puts the notice where the rest would be.
 *
 * The rest is the inspector's to fill in (U10, from its model): the view,
 * the marks by role, the order a preview shows, and what to do with a pick.
 * Left out, the panes open on the host's side and X-ray, and mark nothing.
 */
export interface LayerOrderPanesProps extends LayerPanesEvents {
  readonly status: LayerOrderSessionStatus;
  /**
   * The one pane to show when the dialog is the whole screen (D6), switched
   * from the title row; null when both show side by side. Refused or lost,
   * it is the crease pattern whatever the switch says.
   */
  readonly phonePane: LayerOrderPhonePane | null;
  readonly request: LayerOrderRequest;
  /**
   * The face index, built once per opening: the session's once it is open,
   * the host's scene's before (`requestFaceLetters`); null with neither.
   */
  readonly letters: FaceLetters | null;
  /** Which side shows, X-ray, Undecided: the title row's tools (`LayerOrderViewTools`). */
  readonly view?: LayerPanesView;
  /** The faces marked, by role, and the spots lit. */
  readonly marks?: LayerFaceMarks;
  /** The order the folded figure draws, per side: a preview's while one shows; absent for the session's own. */
  readonly stacks?: LayerPanesStacks | null;
}

export interface LayerOrderDialogFrameProps {
  /** What the host calls the fold, after the title on a wide screen. */
  readonly name?: string;
  /** Quieter, after the name: the design's credit. */
  readonly byline?: string;
  readonly status: LayerOrderSessionStatus;
  /** The faces' letters, for a refusal that names a face. */
  readonly letters: FaceLetters | null;
  readonly returnFocus: HTMLElement | null;
  /** The phone's one pane, or null on a screen wide enough for both: see {@link LayerOrderPanesProps}. */
  readonly phonePane: LayerOrderPhonePane | null;
  readonly onPhonePaneChange: (pane: LayerOrderPhonePane) => void;
  /** The title row's tools, before the close button: Side, X-ray, Undecided (U8, U10). */
  readonly tools?: ReactNode;
  /** The panes region (U8). */
  readonly panes: ReactNode;
  /** The inspector region once the session is ready (U10). */
  readonly inspector?: ReactNode;
  /** The inspector's undo history, for the keys and the menu bar (U10). */
  readonly history?: ModalHistory;
  /** A refusal's Keep trying, a loss's Try again. */
  readonly onRetry: () => void;
  readonly onCancel: () => void;
  readonly onApply: () => void;
  /**
   * Why Apply waits once the session is open, as a title (`applyWaitText`):
   * the shell's, from what it opened on (`openedApplyBlocker`), until U10's
   * inspector passes the reducer's (`applyBlocker`). Null when it can apply.
   */
  readonly applyWaits?: string | null;
  readonly applying: boolean;
  readonly applyRefusal: LayerRefusal | null;
  /**
   * A line beside Cancel and Apply about the order the dialog opened on (D19:
   * "Edit’s order can’t fold here…"; a host's own, such as D12's stale
   * order), in the quiet tone; pointing at it calls `onHover`. Apply's
   * refusal takes its place while there is one. One line with its whole text
   * as its title where a pointer can hover; on a phone or under a finger, it
   * wraps to three lines over Cancel and Apply.
   */
  readonly note?: { readonly text: string; readonly onHover?: (on: boolean) => void } | null;
}

/**
 * The Layer order dialog's frame (`implementation-plans/layer-order-dialog.md`,
 * row U4; approved as A3 in `Round3`, its states in `Round4-States`, the phone
 * in `Round4-Phone`): the app's modal frame at the workspace size, with the
 * title row ("Layer order │ Kabuto Traditional"), a body of two regions (the
 * panes, then the inspector) and a foot with Cancel and Apply.
 *
 * Wide, the body is the two panes side by side and the inspector beside them;
 * as the whole screen (D6), one pane at a time, switched from the title row,
 * with the inspector under it, and the name gives way to the switch. While
 * the session opens the inspector says so; refused or lost, a notice stands
 * where the folded figure and the inspector would be. Cancel, Escape and the
 * close button close it; a press on the backdrop does not, so a stray press
 * never throws away the constraints. The frame is a shortcut barrier, so the
 * workspace's keys and its menus' Undo, Redo and view switches stay behind it.
 */
export function LayerOrderDialogFrame({
  name,
  byline,
  status,
  letters,
  returnFocus,
  phonePane,
  onPhonePaneChange,
  tools,
  panes,
  inspector,
  history,
  onRetry,
  onCancel,
  onApply,
  applyWaits = null,
  applying,
  applyRefusal,
  note = null,
}: LayerOrderDialogFrameProps) {
  const { t } = useTranslation();
  const notice = sessionNotice(t, status, { letters, name });
  const longOpen = useLayerOrderLongOpen(status);
  const applyBlocked = applyBlockedReason();

  function applyBlockedReason(): string | null {
    if (status.kind === 'opening') return applyWaitText(t, 'opening');
    if (status.kind !== 'ready') return applyWaitText(t, 'refused');
    if (applying) return t('dialogs:layerOrder.applying', 'Saving the layer order…');
    return applyWaits;
  }

  const retryLabel =
    notice?.retry === 'keep_trying'
      ? t('dialogs:layerOrder.keepTrying', 'Keep trying')
      : notice?.retry === 'try_again'
        ? t('dialogs:layerOrder.tryAgain', 'Try again')
        : null;

  return (
    <ModalFrame
      title={t('dialogs:layerOrder.title', 'Layer order')}
      size="workspace"
      layout="fill"
      lead={
        phonePane !== null ? (
          <SegmentedControl
            size="sm"
            aria-label={t('dialogs:layerOrder.pane.label', 'Pane')}
            value={status.kind === 'opening' || status.kind === 'ready' ? phonePane : 'crease'}
            disabled={status.kind === 'refused' || status.kind === 'lost'}
            onChange={onPhonePaneChange}
            options={[
              { value: 'folded', label: t('dialogs:layerOrder.pane.folded', 'Folded') },
              { value: 'crease', label: t('dialogs:layerOrder.pane.creasePattern', 'Crease pattern') },
            ]}
          />
        ) : undefined
      }
      detail={
        name && phonePane === null ? (
          <span className={styles.figure}>
            <span className={styles.separator} aria-hidden="true" />
            <span className={styles.name}>{name}</span>
            {byline && <span className={styles.byline}>{byline}</span>}
          </span>
        ) : undefined
      }
      tools={tools}
      onClose={onCancel}
      closeOnBackdrop={false}
      returnFocus={returnFocus}
      history={history}
      footer={
        applyRefusal ? (
          <p className={styles.footNote} data-layout={phonePane === null ? 'wide' : 'narrow'} role="alert">
            <CircleAlert size={14} className={styles.footIcon} aria-hidden="true" />
            {applyRefusalText(t, applyRefusal)}
          </p>
        ) : note && status.kind === 'ready' ? (
          <p
            className={styles.footNote}
            data-tone="info"
            data-layout={phonePane === null ? 'wide' : 'narrow'}
            role="status"
            title={note.text}
            onPointerEnter={() => note.onHover?.(true)}
            onPointerLeave={() => note.onHover?.(false)}
          >
            <Info size={14} className={styles.footIcon} data-tone="info" aria-hidden="true" />
            <span className={styles.footText}>{note.text}</span>
          </p>
        ) : undefined
      }
      actions={
        <>
          <Button size="sm" variant="ghost" onClick={onCancel}>
            {t('dialogs:layerOrder.cancel', 'Cancel')}
          </Button>
          <Button
            size="sm"
            variant="primary"
            aria-disabled={applyBlocked !== null || undefined}
            title={applyBlocked ?? undefined}
            onClick={() => {
              if (applyBlocked === null) onApply();
            }}
          >
            {t('dialogs:layerOrder.apply', 'Apply')}
          </Button>
        </>
      }
    >
      <div className={styles.body} data-layout={phonePane === null ? 'wide' : 'narrow'} data-session={status.kind}>
        <div className={styles.panes}>{panes}</div>
        {notice ? (
          <div className={styles.noticeArea}>
            <div className={styles.notice}>
              <Notice
                tone={notice.tone}
                actions={retryLabel ? [{ id: notice.retry ?? 'retry', label: retryLabel, run: onRetry }] : []}
              >
                <p className={styles.noticeText}>{notice.text}</p>
              </Notice>
            </div>
          </div>
        ) : (
          <aside className={styles.inspector} aria-label={t('dialogs:layerOrder.details', 'Layer order details')}>
            {status.kind === 'ready' ? (
              inspector
            ) : (
              <p className={styles.working} role="status">
                <span>{t('dialogs:layerOrder.opening', 'Working out the layer orders…')}</span>
                {longOpen && (
                  <span className={styles.workingLong}>
                    {t('dialogs:layerOrder.openingLong', 'Large figures can take up to a minute.')}
                  </span>
                )}
              </p>
            )}
          </aside>
        )}
      </div>
    </ModalFrame>
  );
}
