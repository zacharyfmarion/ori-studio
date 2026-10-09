import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ZOOM_SCALE } from '../../diagram/annotate/annotationModel';
import type { ZoomControls } from '../../diagram/zoom/useZoomControls';
import { zoomNumber, zoomReadoutText, type ZoomAction } from '../../diagram/zoom/zoomActions';
import { Button } from '../ui/Button';
import { FieldRow, NumberRow, SegmentedRow } from '../ui/fieldRows';
import styles from './DiagramZoomRows.module.css';

/** A fixed Size's step in the field, as a close-up's scale steps. */
const SIZE_STEP = 0.25;

/**
 * An enlargement's rows that two panes draw from one binding
 * (`useZoomControls`): the Layers pane's controls for an area or a frame
 * (`DiagramZoomControls`), and Annotate's Enlarged section in the Step pane
 * (`DiagramStepEnlarged`), so the two cannot drift.
 *
 * Size: Fill, or a fixed multiple of the area as it prints, with its field.
 */
export function ZoomSizeRows({ controls }: { controls: ZoomControls }) {
  const { t } = useTranslation();
  const { editable, scale } = controls;
  return (
    <>
      <SegmentedRow
        label={t('panels:diagram.annotations.enlargeSize', 'Size')}
        value={scale === null ? 'fill' : 'fixed'}
        disabled={!editable}
        help={t(
          'panels:diagram.annotations.enlargeSizeHelp',
          'Fill prints the enlarged step as large as its room allows, up to six times the area. A fixed Size prints it that many times the area as it prints.'
        )}
        options={[
          { id: 'fill', label: t('panels:diagram.annotations.enlargeFill', 'Fill') },
          { id: 'fixed', label: t('panels:diagram.annotations.enlargeFixed', 'Fixed') },
        ]}
        onChange={(next) => controls.setScale(next === 'fill' ? null : (scale ?? ZOOM_SCALE.min))}
      />
      {scale !== null && (
        <NumberRow
          label={t('panels:diagram.annotations.enlargeTimesLabel', 'Times the area')}
          value={scale}
          min={ZOOM_SCALE.min}
          max={ZOOM_SCALE.max}
          step={SIZE_STEP}
          suffix="×"
          disabled={!editable}
          onCommit={(next) => controls.setScale(next)}
        />
      )}
    </>
  );
}

/**
 * The Anchor row, on a step whose faces can be picked: the rule it follows,
 * Auto or Picked, and its verbs, Pick and Reset. Nothing on any other step.
 */
export function ZoomAnchorRow({ controls }: { controls: ZoomControls }) {
  const { t } = useTranslation();
  if (!controls.anchorShown) return null;
  return (
    <FieldRow label={t('panels:diagram.annotations.enlargeAnchor', 'Anchor')} kind="text" disabled={!controls.editable}>
      {/* One line in both states, so picking or resetting moves no row below it: the rule's words are its tooltip. */}
      <span className={styles.anchor}>
        <span
          className={styles.anchorRule}
          title={
            controls.picked
              ? t('panels:diagram.annotations.anchorPickedHint', 'The face picked on the canvas')
              : t('panels:diagram.annotations.anchorAutoHint', 'The backmost face outside the frame')
          }
        >
          {controls.picked
            ? t('panels:diagram.annotations.anchorPicked', 'Picked')
            : t('panels:diagram.annotations.anchorAuto', 'Auto')}
        </span>
        {controls.anchorActions.map((action) => (
          <ZoomVerb key={action.id} action={action} />
        ))}
      </span>
    </FieldRow>
  );
}

/**
 * The read-out under the rows: what a frame prints at once the pages are laid
 * out, amber when its room or its area holds it back; else what Size means.
 */
export function ZoomReadout({ controls }: { controls: ZoomControls }) {
  const { t, i18n } = useTranslation();
  const { readout, scale } = controls;
  return (
    <ZoomNote readout={readout?.kind ?? 'size'} warn={readout?.warn === true}>
      {readout
        ? zoomReadoutText(t, readout, i18n.language)
        : scale === null
          ? t('panels:diagram.annotations.enlargeReadoutFill', 'Prints as large as its room allows, up to ×6 the area.')
          : t('panels:diagram.annotations.enlargeReadoutFixed', 'Prints at {{size}} × the area’s printed size.', {
              size: zoomNumber(scale, i18n.language),
            })}
    </ZoomNote>
  );
}

/** A line under an enlargement's rows, at their inset: a read-out (`readout`, amber when `warn`), or a note. */
export function ZoomNote({ readout, warn = false, children }: { readout?: string; warn?: boolean; children: ReactNode }) {
  return (
    <p className={styles.note} data-readout={readout} data-tone={warn ? 'warning' : undefined}>
      {children}
    </p>
  );
}

/**
 * One of an enlargement's verbs: a button that refuses, keeping the focus,
 * when it cannot act or is waiting on its own work (Update folding faces),
 * and says why.
 */
export function ZoomVerb({ action }: { action: ZoomAction }) {
  const held = action.disabled || action.waiting === true;
  return (
    <Button
      size="sm"
      // A toggle that is on (Pick, while the canvas asks for a face) wears the pressed look.
      variant={action.pressed ? 'secondary' : 'ghost'}
      isActive={action.pressed}
      title={action.hint}
      aria-disabled={held || undefined}
      aria-busy={action.waiting || undefined}
      aria-pressed={action.pressed}
      data-zoom-action={action.id}
      onClick={() => {
        if (!held) action.run();
      }}
    >
      {action.label}
    </Button>
  );
}
