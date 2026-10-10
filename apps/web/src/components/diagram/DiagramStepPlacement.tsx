import { useTranslation } from 'react-i18next';
import type { DiagramStep } from '../../diagram/document/diagramDocument';
import type { PagePart, PlacementClash } from '../../diagram/pages/pagePlacement';
import { useStepPlacement } from '../../diagram/pages/useStepPlacement';
import { useZoomControls } from '../../diagram/zoom/useZoomControls';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { Button } from '../ui/Button';
import { CollapsibleSection } from '../ui/CollapsibleSection';
import { NumberRow } from '../ui/fieldRows';
import { Notice } from '../ui/Notice';
import { ZoomSizeRows } from './DiagramZoomRows';
import styles from './DiagramStepPlacement.module.css';

const PARTS = ['frame', 'number', 'picture', 'text'] as const;
const FRAME = { kind: 'frame' } as const;

export function DiagramStepPlacement({ step }: { step: DiagramStep }) {
  const { t } = useTranslation();
  const place = useStepPlacement(step);
  const labels: Record<PagePart, string> = {
    frame: t('panels:diagram.placement.frame', 'Frame'),
    number: t('panels:diagram.placement.number', 'Number'),
    picture: t('panels:diagram.placement.picture', 'Picture'),
    text: t('panels:diagram.placement.text', 'Text'),
  };
  return (
    <CollapsibleSection title={t('panels:diagram.placement.title', 'On the page')}>
      <div className={styles.controls}>
        {place.blocked === 'newer' ? (
          <Notice>{t('panels:diagram.placement.newer', 'Placed in a newer version')}</Notice>
        ) : (
          <>
            {step.zoom ? (
              <EnlargedSize step={step} />
            ) : (
              <>
                <NumberRow
                  label={t('panels:diagram.placement.size', 'Size (mm)')}
                  value={Math.round((place.size ?? 0) * 10) / 10}
                  min={4}
                  step={0.1}
                  disabled={place.disabled || place.size === null}
                  onCommit={place.setSize}
                  onReset={step.place?.scale ? () => place.reset('scale') : undefined}
                />
                {place.autoSize !== null && (
                  <p className={styles.note}>
                    {t('panels:diagram.placement.autoSize', 'Auto: {{mm}} mm', { mm: place.autoSize.toFixed(1) })}
                  </p>
                )}
                {place.cell?.placed?.pin === 'kind' && (
                  <Notice>
                    {'mmPerUnit' in (step.place?.scale ?? {})
                      ? t('panels:diagram.placement.keptPattern', 'Size kept for a crease pattern')
                      : t('panels:diagram.placement.keptFitted', 'Size kept for a fitted picture')}
                  </Notice>
                )}
              </>
            )}
            {PARTS.map((part) => (
              <div key={part} className={styles.part}>
                <span>{labels[part]}</span>
                <span className={styles.note}>
                  {step.place?.[part]
                    ? t('panels:diagram.placement.moved', 'Moved')
                    : t('panels:diagram.placement.auto', 'Auto')}
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={t('panels:diagram.placement.selectPart', 'Select {{part}}', { part: labels[part] })}
                  isActive={place.selected === part}
                  disabled={place.disabled || (part === 'text' && !step.text.trim())}
                  onClick={() => place.select(part)}
                >
                  {t('panels:diagram.placement.select', 'Select')}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={t('panels:diagram.placement.resetPart', 'Reset {{part}}', { part: labels[part] })}
                  disabled={place.disabled || !step.place?.[part]}
                  onClick={() => place.reset(part)}
                >
                  {t('panels:diagram.placement.reset', 'Reset')}
                </Button>
              </div>
            ))}
            {place.selected && (
              <div>
                <NumberRow
                  label={t('panels:diagram.placement.offsetX', 'X (mm)')}
                  value={place.offset(place.selected)[0]}
                  step={0.5}
                  disabled={place.disabled}
                  onCommit={(value) => place.setOffset(place.selected!, 0, value)}
                />
                <NumberRow
                  label={t('panels:diagram.placement.offsetY', 'Y (mm)')}
                  value={place.offset(place.selected)[1]}
                  step={0.5}
                  disabled={place.disabled}
                  onCommit={(value) => place.setOffset(place.selected!, 1, value)}
                />
              </div>
            )}
          </>
        )}
        <Button
          size="sm"
          disabled={place.readOnly || (!step.place && !step.placeNewer)}
          onClick={() => place.reset('all')}
        >
          {t('panels:diagram.placement.resetLayout', 'Reset Layout')}
        </Button>
        {!!place.cell?.clashes?.length && (
          <Notice tone="warning">
            {place.cell.clashes.map((clash, index) => (
              <p key={index} className={styles.note}>
                <ClashWords clash={clash} />
              </p>
            ))}
            {!step.breakBefore && (
              <Button
                size="sm"
                disabled={place.readOnly}
                onClick={() => useWorkspaceStore.getState().setDiagramStepBreakBefore(step.id, true)}
              >
                {t('panels:diagram.placement.breakBefore', 'Start step {{number}} on a new page', {
                  number: place.cell.number,
                })}
              </Button>
            )}
          </Notice>
        )}
      </div>
    </CollapsibleSection>
  );
}

function EnlargedSize({ step }: { step: DiagramStep }) {
  const controls = useZoomControls(step, FRAME);
  return <ZoomSizeRows controls={controls} />;
}

function ClashWords({ clash }: { clash: PlacementClash }) {
  const { t } = useTranslation();
  switch (clash.kind) {
    case 'parts':
      return t('panels:diagram.placement.partsClash', 'The picture, number, or text overlap within this step.');
    case 'paper':
      return t('panels:diagram.placement.paperClash', 'Part of this step is outside the paper.');
    case 'margin':
      return t('panels:diagram.placement.marginClash', 'Part of this step crosses the margin.');
    case 'glyph':
      return t('panels:diagram.placement.glyphClash', 'This step overlaps a symbol, heading, or page number.');
    case 'path':
      return t('panels:diagram.placement.pathClash', 'This placement makes the path double back or cross itself.');
    case 'step':
      return t('panels:diagram.placement.stepClash', 'This step overlaps steps {{steps}}.', {
        steps: clash.steps?.join(', '),
      });
  }
}
