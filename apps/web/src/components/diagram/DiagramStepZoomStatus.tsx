import { useTranslation } from 'react-i18next';
import type { DiagramStep } from '../../diagram/document/diagramDocument';
import { useStepZoom } from '../../diagram/zoom/useStepZoom';
import { zoomReadoutText, type StepZoomNotice, type ZoomRecapture } from '../../diagram/zoom/zoomActions';
import { CollapsibleSection } from '../ui/CollapsibleSection';
import { FieldRow } from '../ui/fieldRows';
import { Notice } from '../ui/Notice';
import styles from './DiagramStepZoomStatus.module.css';

type T = ReturnType<typeof useTranslation>['t'];

/**
 * The Step pane's word on an enlarged step (Revision 2, Controls): where its
 * frame came from — the area's step a row that goes to it — its Size and,
 * once the pages are laid out, what it prints at; and the notices that need
 * a hand: it prints smaller than asked, or barely enlarged; the frame holds
 * no paper here; its anchor is not on this step's paper; a frame copied in
 * picture units that its steps' faces would anchor, after a Refresh of the
 * steps captured before steps kept them. Each names the verb that fixes it;
 * the pane has no buttons of its own for them. Nothing for a step that is
 * not enlarged.
 */
export function DiagramStepZoomStatus({ step }: { step: DiagramStep }) {
  const { t } = useTranslation();
  const { status, readout, goToArea } = useStepZoom(step);
  if (!status) return null;
  const { areaStep, scale, notices } = status;
  const size =
    scale === null
      ? t('panels:diagram.annotations.enlargeFill', 'Fill')
      : t('panels:diagram.annotations.enlargeTimes', '×{{size}}', { size: scale });
  return (
    <CollapsibleSection title={t('panels:diagram.stepPane.enlarged', 'Enlarged')}>
      <div className={styles.status} data-step-zoom-status="">
        <div>
          <FieldRow label={t('panels:diagram.stepPane.enlargedFrom', 'From')} kind="static" onClick={areaStep ? goToArea : undefined}>
            {areaStep
              ? t('panels:diagram.stepPane.enlargedFromArea', 'Step {{number}}’s area', { number: areaStep.number })
              : t('panels:diagram.stepPane.enlargedFromGone', 'An area no longer in the diagram')}
          </FieldRow>
          <FieldRow label={t('panels:diagram.annotations.enlargeSize', 'Size')} kind="static" divider={false}>
            {readout && !readout.warn
              ? t('panels:diagram.stepPane.enlargedSizePrints', '{{size}} · prints ×{{printed}}', {
                  size,
                  printed: readout.printed,
                })
              : size}
          </FieldRow>
        </div>
        {readout?.warn && <Notice tone="warning">{zoomReadoutText(t, readout)}</Notice>}
        {notices.map((notice) => (
          <Notice key={noticeKey(notice)} tone="warning">
            {noticeText(t, notice)}
          </Notice>
        ))}
      </div>
    </CollapsibleSection>
  );
}

function noticeKey(notice: StepZoomNotice): string {
  return notice.kind === 'refresh' ? `refresh-${notice.stepId}` : notice.kind;
}

function noticeText(t: T, notice: StepZoomNotice): string {
  switch (notice.kind) {
    case 'no-paper':
      return t(
        'panels:diagram.stepPane.enlargedNoPaper',
        'The enlarged frame holds no paper on this step. Pick its anchor on the area and Update Enlarged Steps, or move the frame in Annotate.'
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
            'Update Enlarged Steps on step {{area}}’s area to anchor the frame to its paper.',
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
        'Refresh step {{number}}, then Update Enlarged Steps on step {{area}}’s area, to anchor the frame to its paper.',
        { number, area: then.update }
      )
    : t(
        'panels:diagram.stepPane.enlargedRefreshToggle',
        'Refresh step {{number}}, then turn Enlarged off and on, to anchor the frame to its paper.',
        { number }
      );
}
