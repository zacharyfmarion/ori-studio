import { forwardRef, useCallback, useRef, type ForwardedRef } from 'react';
import { useTranslation } from 'react-i18next';
import { ImagePlus, Lock, Upload } from 'lucide-react';
import {
  isLockedStep,
  type DiagramAsset,
  type DiagramStep,
} from '../../diagram/document/diagramDocument';
import { stepPictureSource } from '../../diagram/pictures/paintDiagramStep';
import { useStepPictureUrl } from '../../diagram/pictures/useStepPictureUrl';
import { Badge } from '../ui/Badge';
import styles from './DiagramStepCard.module.css';

/**
 * One step in the Steps grid: its number and kind, its picture, and its
 * instruction.
 *
 * An `option` of the grid's listbox rather than a button: the grid is one
 * control, navigated with the arrows, and a screen reader announces it as a
 * list to choose from rather than a row of unrelated buttons. The grid moves
 * focus between cards as the selection moves (a roving tab stop), which is
 * what lets a screen reader follow it.
 *
 * An empty card's Upload… is a pointer's shortcut and out of the tab order:
 * an option's contents are presentational to assistive technology, and the
 * same verb is in the card's menu and the Step pane, where a keyboard reaches
 * it.
 */
export const DiagramStepCard = forwardRef<
  HTMLDivElement,
  {
    step: DiagramStep;
    assets: Readonly<Record<string, DiagramAsset>>;
    /** 1-based, as the page will print it. */
    number: number;
    selected: boolean;
    /** Whether this card is the grid's tab stop. */
    tabStop: boolean;
    /** A picture dragged over the grid would land on this card. */
    dropTarget: boolean;
    readOnly: boolean;
    onSelect: (stepId: string) => void;
    /** Open this step in detail. */
    onOpen: (stepId: string) => void;
    /** Pick a picture for this step. Called from the click itself. */
    onUpload: (stepId: string) => void;
  }
>(function DiagramStepCard(
  { step, assets, number, selected, tabStop, dropTarget, readOnly, onSelect, onOpen, onUpload },
  forwarded
) {
  const { t } = useTranslation();
  const own = useRef<HTMLDivElement | null>(null);
  const ref = useCallback(
    (element: HTMLDivElement | null) => {
      own.current = element;
      assignRef(forwarded, element);
    },
    [forwarded]
  );
  const locked = isLockedStep(step);
  const text = step.text.trim();
  const picture = stepPictureSource(step, assets);
  const url = useStepPictureUrl(own, step, assets);

  return (
    <div
      ref={ref}
      role="option"
      aria-selected={selected}
      tabIndex={tabStop ? 0 : -1}
      className={styles.card}
      data-selected={selected || undefined}
      data-drop-target={dropTarget || undefined}
      data-step-id={step.id}
      onClick={() => onSelect(step.id)}
      onDoubleClick={() => onOpen(step.id)}
    >
      <div className={styles.header}>
        <span className={styles.number}>
          {t('panels:diagram.card.number', 'Step {{number}}', { number })}
        </span>
        <Badge tone="neutral">
          {locked
            ? t('panels:diagram.card.badgeNewer', 'Newer')
            : picture?.asset.kind === 'svg'
              ? t('panels:diagram.card.badgeSvg', 'SVG')
              : picture?.asset.kind === 'raster'
                ? t('panels:diagram.card.badgeImage', 'Image')
                : t('panels:diagram.card.badgeEmpty', 'Empty')}
        </Badge>
      </div>
      <div className={styles.well} data-picture={(picture !== null && !locked) || undefined}>
        {locked ? (
          <span className={styles.placeholder}>
            <Lock size={18} aria-hidden="true" />
            {t('panels:diagram.card.locked', 'Made with a newer Ori Studio')}
          </span>
        ) : picture ? (
          url && <img className={styles.picture} src={url} alt="" draggable={false} decoding="async" />
        ) : (
          <span className={styles.placeholder}>
            <ImagePlus size={18} aria-hidden="true" />
            {t('panels:diagram.card.noPicture', 'No picture yet')}
            {!readOnly && (
              <button
                type="button"
                tabIndex={-1}
                className={styles.upload}
                onClick={() => onUpload(step.id)}
              >
                <Upload size={13} aria-hidden="true" />
                {t('panels:diagram.card.upload', 'Upload…')}
              </button>
            )}
          </span>
        )}
      </div>
      <p className={styles.instruction} data-empty={text === '' || undefined}>
        {text === '' ? t('panels:diagram.card.noInstruction', 'No instruction') : text}
      </p>
    </div>
  );
});

function assignRef<T>(ref: ForwardedRef<T>, value: T | null): void {
  if (typeof ref === 'function') ref(value);
  else if (ref) ref.current = value;
}
