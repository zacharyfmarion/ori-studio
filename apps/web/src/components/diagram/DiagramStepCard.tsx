import { forwardRef, useCallback, useId, useRef, type ForwardedRef } from 'react';
import { useTranslation } from 'react-i18next';
import { ImagePlus, Link2, Lock, Upload } from 'lucide-react';
import type { TFunction } from 'i18next';
import {
  isLockedStep,
  type DiagramAsset,
  type DiagramStep,
  type DiagramStyle,
} from '../../diagram/document/diagramDocument';
import type { DiagramLinkStatus } from '../../diagram/capture/linkStatus';
import { stepPictureSource, type StepPictureSource } from '../../diagram/pictures/paintDiagramStep';
import { useStepPictureUrl } from '../../diagram/pictures/useStepPictureUrl';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { DiagramSheetThumbnail } from './DiagramSheetThumbnail';
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
 * An empty card's Upload… and Link…, and a capture's Stop, are a pointer's
 * shortcuts, hidden from assistive technology and out of the tab order: the
 * same verbs are in the card's menu and the Step pane, where a keyboard and a
 * screen reader reach them. The card names itself from its number, kind, how
 * its link stands and its instruction, so a shortcut's label is not read as
 * part of it.
 *
 * A linked step shows its pattern's thumbnail beside its kind, and says over
 * its picture when the pattern has changed or gone.
 */
export const DiagramStepCard = forwardRef<
  HTMLDivElement,
  {
    step: DiagramStep;
    assets: Readonly<Record<string, DiagramAsset>>;
    /** The pens a captured picture is painted in. */
    style: DiagramStyle;
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
    /** How the step's link stands; null for a step that is not linked. */
    link: DiagramLinkStatus | null;
    /** The step's capture while one runs, and whether its fold can be stopped. */
    capture: { stoppable: boolean } | null;
    /** A crease pattern is open to link an empty step to. */
    patternOpen: boolean;
    /** Choose a pattern for this step. */
    onLink: (stepId: string) => void;
    onStop: (stepId: string) => void;
  }
>(function DiagramStepCard(
  {
    step,
    assets,
    style,
    number,
    selected,
    tabStop,
    dropTarget,
    readOnly,
    onSelect,
    onOpen,
    onUpload,
    link,
    capture,
    patternOpen,
    onLink,
    onStop,
  },
  forwarded
) {
  const { t } = useTranslation();
  const labelId = useId();
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
  const url = useStepPictureUrl(own, step, assets, style);
  const linked = !locked && step.source?.kind === 'cp' ? step.source : null;
  const chip = capture
    ? t('panels:diagram.card.capturing', 'Capturing…')
    : link === 'stale'
      ? t('panels:diagram.card.stale', 'Out of date')
      : link === 'missing'
        ? t('panels:diagram.card.missing', 'Pattern missing')
        : null;
  // A press must not take focus from the card's keys.
  const keepFocus = (event: { preventDefault: () => void }) => event.preventDefault();

  return (
    <div
      ref={ref}
      role="option"
      aria-selected={selected}
      tabIndex={tabStop ? 0 : -1}
      aria-labelledby={`${labelId}-number ${labelId}-kind${chip ? ` ${labelId}-chip` : ''} ${labelId}-text`}
      className={styles.card}
      data-selected={selected || undefined}
      data-drop-target={dropTarget || undefined}
      data-step-id={step.id}
      onClick={() => onSelect(step.id)}
      onDoubleClick={() => onOpen(step.id)}
    >
      <div className={styles.header}>
        <span id={`${labelId}-number`} className={styles.number}>
          {t('panels:diagram.card.number', 'Step {{number}}', { number })}
        </span>
        <span className={styles.kind}>
          {linked && (
            <span className={styles.pattern}>
              <DiagramSheetThumbnail thumbnail={linked.thumbnail} />
            </span>
          )}
          <span id={`${labelId}-kind`}>
            <Badge tone="neutral">
              {locked ? t('panels:diagram.card.badgeNewer', 'Newer') : stepKindLabel(step, picture, t)}
            </Badge>
          </span>
        </span>
      </div>
      <div className={styles.well} data-picture={(picture !== null && !locked) || undefined}>
        {locked ? (
          <span className={styles.placeholder}>
            <Lock size={18} aria-hidden="true" />
            {t('panels:diagram.card.locked', 'Made with a newer Ori Studio')}
          </span>
        ) : picture ? (
          url && <img className={styles.picture} src={url} alt="" draggable={false} decoding="async" />
        ) : linked ? (
          <span className={styles.placeholder}>{t('panels:diagram.card.notCaptured', 'Not captured yet')}</span>
        ) : (
          <span className={styles.placeholder}>
            <ImagePlus size={18} aria-hidden="true" />
            {t('panels:diagram.card.noPicture', 'No picture yet')}
            {!readOnly && (
              <span className={styles.shortcuts}>
                <Button
                  size="sm"
                  variant="secondary"
                  tabIndex={-1}
                  aria-hidden="true"
                  onMouseDown={keepFocus}
                  onClick={() => onUpload(step.id)}
                >
                  <Upload size={13} aria-hidden="true" />
                  {t('panels:diagram.card.upload', 'Upload…')}
                </Button>
                {patternOpen && (
                  <Button
                    size="sm"
                    variant="secondary"
                    tabIndex={-1}
                    aria-hidden="true"
                    onMouseDown={keepFocus}
                    onClick={(event) => {
                      // The picker selects the step itself.
                      event.stopPropagation();
                      onLink(step.id);
                    }}
                  >
                    <Link2 size={13} aria-hidden="true" />
                    {t('panels:diagram.card.link', 'Link…')}
                  </Button>
                )}
              </span>
            )}
          </span>
        )}
        {chip && (
          <span className={styles.chip} data-tone={capture ? 'progress' : 'warning'}>
            <span id={`${labelId}-chip`}>{chip}</span>
            {capture?.stoppable && (
              <button
                type="button"
                className={styles.stop}
                tabIndex={-1}
                aria-hidden="true"
                onMouseDown={keepFocus}
                onClick={(event) => {
                  event.stopPropagation();
                  onStop(step.id);
                }}
              >
                {t('panels:diagram.card.stop', 'Stop')}
              </button>
            )}
          </span>
        )}
      </div>
      <p id={`${labelId}-text`} className={styles.instruction} data-empty={text === '' || undefined}>
        {text === '' ? t('panels:diagram.card.noInstruction', 'No instruction') : text}
      </p>
    </div>
  );
});

/**
 * What the step is, for its badge: where a linked step comes from and how it
 * is shown, or what an upload is.
 */
function stepKindLabel(step: DiagramStep, picture: StepPictureSource | null, t: TFunction): string {
  if (step.source?.kind === 'cp') {
    switch (step.source.render.mode) {
      case 'crease-pattern':
        return t('panels:diagram.card.badgeCreasePattern', 'Crease pattern');
      case 'folded-flat':
        return t('panels:diagram.card.badgeFolded', 'Folded');
      case 'folded-3d':
        return t('panels:diagram.card.badgeFolded3d', 'Folded · 3D');
    }
  }
  if (picture?.kind === 'asset') {
    return picture.asset.kind === 'svg'
      ? t('panels:diagram.card.badgeSvg', 'SVG')
      : t('panels:diagram.card.badgeImage', 'Image');
  }
  return t('panels:diagram.card.badgeEmpty', 'Empty');
}

function assignRef<T>(ref: ForwardedRef<T>, value: T | null): void {
  if (typeof ref === 'function') ref(value);
  else if (ref) ref.current = value;
}
