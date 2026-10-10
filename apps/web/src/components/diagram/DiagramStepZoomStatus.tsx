import { useTranslation } from 'react-i18next';
import { RefreshCw } from 'lucide-react';
import { diagramStepCommand, type DiagramStepAction } from '../../diagram/actions/diagramActions';
import type { DiagramStep } from '../../diagram/document/diagramDocument';
import type { EnlargedAreaStatus } from '../../diagram/zoom/areaStatus';
import { useStepZoom, type HeldAreasView } from '../../diagram/zoom/useStepZoom';
import {
  zoomNumber,
  zoomReadoutText,
  type StepZoomNotice,
  type StepZoomStatus,
  type ZoomRecapture,
} from '../../diagram/zoom/zoomActions';
import { ActionList } from '../ui/ActionList';
import { CollapsibleSection } from '../ui/CollapsibleSection';
import { FieldRow } from '../ui/fieldRows';
import { Notice } from '../ui/Notice';
import { ZoomNote } from './DiagramZoomRows';
import styles from './DiagramStepZoomStatus.module.css';

type T = ReturnType<typeof useTranslation>['t'];

/**
 * The Step pane's word on an enlarged step (Revision 2, Controls), out of the
 * step detail: where its frame came from — the area's step a row that goes
 * to it, or that the area was deleted — its Size and, once the pages are
 * laid out, what it prints at; and the notices that need a hand: its area
 * changed since (review fix 4), with the step's Update; it prints smaller
 * than asked, or barely enlarged; the frame holds no paper here; its anchor
 * is not on this step's paper; a frame copied in picture units that its
 * steps' faces would anchor, after a Refresh of the steps captured before
 * steps kept them. Each names the verb that fixes it; Update, the step's
 * own, is the one the pane offers. On a step that holds an area, while a
 * step enlarged from it is out of date, which steps were and are, and Update
 * All (review of review fix 4). Nothing for any other step.
 * In Annotate the Step pane has the section you can edit instead
 * (`DiagramStepEnlarged`), and in Pose none — but this, on a step Annotate
 * cannot open, which has no picture yet.
 */
export function DiagramStepZoomStatus({ step, actions }: { step: DiagramStep; actions: readonly DiagramStepAction[] }) {
  const { t, i18n } = useTranslation();
  const { status, readout, goToArea, areas } = useStepZoom(step);
  if (!status) {
    return areas?.offered ? (
      <CollapsibleSection title={t('panels:diagram.stepPane.enlarged', 'Enlarged')}>
        <HeldAreas areas={areas} />
      </CollapsibleSection>
    ) : null;
  }
  const { area, scale, notices } = status;
  const size =
    scale === null
      ? t('panels:diagram.annotations.enlargeFill', 'Fill')
      : t('panels:diagram.annotations.enlargeTimes', '×{{size}}', { size: zoomNumber(scale, i18n.language) });
  return (
    <CollapsibleSection title={t('panels:diagram.stepPane.enlarged', 'Enlarged')}>
      <div className={styles.status} data-step-zoom-status="">
        <div>
          <EnlargedFromRow area={area} onGo={goToArea} />
          <FieldRow label={t('panels:diagram.annotations.enlargeSize', 'Size')} kind="static" divider={false}>
            {readout && !readout.warn
              ? t('panels:diagram.stepPane.enlargedSizePrints', '{{size}} · prints ×{{printed}}', {
                  size,
                  printed: zoomNumber(readout.printed, i18n.language),
                })
              : size}
          </FieldRow>
        </div>
        <EnlargedAreaUpdate status={status} actions={actions} />
        {readout?.warn && <Notice tone="warning">{zoomReadoutText(t, readout, i18n.language)}</Notice>}
        <StepZoomNotices notices={notices} />
      </div>
    </CollapsibleSection>
  );
}

/**
 * A step that holds an area (review fix 4): the steps enlarged from it, and —
 * while any of them is out of date — which, and Update All, offered as
 * Refresh Picture is, only where it does what the pane says. Annotate's
 * Enlarged section and the read-only one draw it alike.
 */
export function HeldAreas({ areas }: { areas: HeldAreasView }) {
  const { t } = useTranslation();
  const { subtitle, stale, updateAll, offered } = areas;
  return (
    <div className={styles.areas} data-held-areas="" data-offered={offered || undefined}>
      <ZoomNote>{subtitle}</ZoomNote>
      {offered && stale && <ZoomNote warn>{stale}</ZoomNote>}
      {offered && (
        <ActionList
          aria-label={t('panels:diagram.stepPane.enlargedVerbs', 'Enlarged actions')}
          groups={[
            [
              {
                id: updateAll.id,
                icon: RefreshCw,
                label: updateAll.label,
                hint: updateAll.hint,
                waiting: updateAll.waiting,
                run: updateAll.run,
              },
            ],
          ]}
        />
      )}
    </div>
  );
}

/**
 * Where an enlarged step's frame came from: the area's step, a row that goes
 * there (`onGo`); its step, once the area was deleted (review fix 4); or an
 * area no longer in the diagram, its step gone too or never recorded. The
 * Step pane's, read only or in Annotate.
 */
export function EnlargedFromRow({ area, onGo }: { area: EnlargedAreaStatus; onGo: (() => void) | undefined }) {
  const { t } = useTranslation();
  const { areaStep } = area;
  const there = areaStep !== null && area.kind !== 'deleted';
  return (
    <FieldRow label={t('panels:diagram.stepPane.enlargedFrom', 'From')} kind="static" onClick={there ? onGo : undefined}>
      {areaStep === null
        ? t('panels:diagram.stepPane.enlargedFromGone', 'An area no longer in the diagram')
        : there
          ? t('panels:diagram.stepPane.enlargedFromArea', 'Step {{number}}’s area', { number: areaStep.number })
          : t('panels:diagram.stepPane.enlargedFromDeleted', 'Step {{number}}’s area was deleted', { number: areaStep.number })}
    </FieldRow>
  );
}

/**
 * An enlarged step whose area changed since its frame was captured from it
 * (review fix 4): "Out of date: Step N's area changed", as a linked picture
 * says its pattern changed, and the step's Update under it — offered, as
 * Refresh Picture is, only while the step is out of date: the area changed,
 * or a notice says Update anchors the frame — and waiting while it runs.
 * Nothing otherwise.
 */
export function EnlargedAreaUpdate({ status, actions }: { status: StepZoomStatus; actions: readonly DiagramStepAction[] }) {
  const { t } = useTranslation();
  const update = diagramStepCommand(actions, 'update-enlarged');
  const changed = status.area.kind === 'changed' ? status.area.areaStep : null;
  const offered = update !== null && (update.waiting === true || (status.outOfDate && !update.disabled));
  if (!changed && !offered) return null;
  return (
    <div className={styles.area} data-enlarged-area={status.area.kind}>
      {changed && (
        <div className={styles.notice}>
          <Notice tone="warning">
            {t('panels:diagram.stepPane.enlargedAreaChanged', 'Out of date: Step {{number}}’s area changed', {
              number: changed.number,
            })}
          </Notice>
        </div>
      )}
      {offered && (
        <ActionList
          aria-label={t('panels:diagram.stepPane.enlargedVerbs', 'Enlarged actions')}
          groups={[
            [{ id: update.id, icon: RefreshCw, label: update.label, hint: update.hint, waiting: update.waiting, run: update.run }],
          ]}
        />
      )}
    </div>
  );
}

/** An enlarged step's notices (`stepZoomStatus`), each naming the verb that fixes it. */
export function StepZoomNotices({ notices }: { notices: readonly StepZoomNotice[] }) {
  const { t } = useTranslation();
  return notices.map((notice) => (
    <Notice key={noticeKey(notice)} tone="warning">
      {noticeText(t, notice)}
    </Notice>
  ));
}

function noticeKey(notice: StepZoomNotice): string {
  return notice.kind === 'refresh' ? `refresh-${notice.stepId}` : notice.kind;
}

function noticeText(t: T, notice: StepZoomNotice): string {
  switch (notice.kind) {
    case 'no-paper':
      return t(
        'panels:diagram.stepPane.enlargedNoPaper',
        'The enlarged frame holds no paper on this step. Pick its anchor on the area, then Update, or move the frame in Annotate.'
      );
    case 'anchor-off-paper':
      return t(
        'panels:diagram.stepPane.enlargedAnchorOff',
        'The frame’s anchor is not on this step’s paper, so the frame stays where it was. Move it in Annotate if it needs to.'
      );
    case 'refresh':
      return refreshText(t, notice.number, notice.then);
    case 'unanchored':
      return notice.then
        ? t(
            'panels:diagram.stepPane.enlargedUnanchoredUpdate',
            'Update from step {{area}}’s area to anchor the frame to its paper.',
            { area: notice.then.update }
          )
        : t('panels:diagram.stepPane.enlargedUnanchoredToggle', 'Turn Enlarged off and on to anchor the frame to its paper.');
  }
}

/** A Refresh of step `number`, then what captures the frame again with its faces. */
function refreshText(t: T, number: number, then: ZoomRecapture): string {
  return then
    ? t(
        'panels:diagram.stepPane.enlargedRefreshUpdate',
        'Refresh step {{number}}, then Update from step {{area}}’s area, to anchor the frame to its paper.',
        { number, area: then.update }
      )
    : t(
        'panels:diagram.stepPane.enlargedRefreshToggle',
        'Refresh step {{number}}, then turn Enlarged off and on, to anchor the frame to its paper.',
        { number }
      );
}
