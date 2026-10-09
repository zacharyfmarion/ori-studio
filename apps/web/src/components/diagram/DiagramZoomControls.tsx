import { useTranslation } from 'react-i18next';
import { ZOOM_SCALE } from '../../diagram/annotate/annotationModel';
import type { DiagramStep, DiagramZoomEdge, DiagramZoomShape } from '../../diagram/document/diagramDocument';
import { useZoomControls, type ZoomControlsTarget } from '../../diagram/zoom/useZoomControls';
import { zoomNumber, zoomReadoutText } from '../../diagram/zoom/zoomActions';
import { FieldRow, NumberRow, SegmentedRow } from '../ui/fieldRows';
import { SegmentedControl } from '../ui/SegmentedControl';
import { DiagramAnchorRow } from './DiagramAnchorRow';
import { DiagramZoomVerb } from './DiagramZoomVerb';
import styles from './DiagramZoomControls.module.css';

/** A fixed Size's step in the field, as a close-up's scale steps. */
const SIZE_STEP = 0.25;

/**
 * An enlargement's controls in the Layers pane (Revision 2, Controls): an
 * enlarge area's, or an enlarged step's frame's — Shape, Size (Fill, or a
 * fixed multiple of the area as it prints), Edge (Cut, held where the
 * picture has no paper outline, or Whole), the Anchor row on a step whose
 * faces can be picked, a read-out — what a frame prints at once the pages
 * are laid out, amber when its room or its area holds it back; else what Size
 * means — and the verbs: an
 * area's Update Enlarged Steps and Go to its first enlarged step, a frame's
 * Go to its area, with a note on what places the frame again. Each change is
 * one undo step (`useZoomControls`).
 */
export function DiagramZoomControls({ step, target }: { step: DiagramStep; target: ZoomControlsTarget }) {
  const { t, i18n } = useTranslation();
  const controls = useZoomControls(step, target);
  const { editable, shape, edge, scale } = controls;
  const shapeLabel = t('panels:diagram.annotations.enlargeShape', 'Shape');
  const sizeLabel = t('panels:diagram.annotations.enlargeSize', 'Size');
  const edgeLabel = t('panels:diagram.annotations.enlargeEdge', 'Edge');
  const noOutline = t('panels:diagram.annotations.enlargeCutNone', 'This picture has no paper outline to cut along');
  return (
    <div className={styles.controls} data-zoom-controls={controls.on}>
      <FieldRow label={shapeLabel} kind="segmented" disabled={!editable}>
        {/* Icons, each named by its tooltip: "Rounded rectangle" does not fit beside "Circle" in the pane. */}
        <SegmentedControl<DiagramZoomShape>
          size="sm"
          iconsOnly
          aria-label={shapeLabel}
          value={shape}
          disabled={!editable}
          options={(['circle', 'rounded'] as const).map((value) => {
            const label =
              value === 'circle'
                ? t('panels:diagram.annotations.enlargeCircle', 'Circle')
                : t('panels:diagram.annotations.enlargeRounded', 'Rounded rectangle');
            return { value, label, tooltip: label, icon: <ShapeMark shape={value} /> };
          })}
          onChange={(next) => controls.setShape(next)}
        />
      </FieldRow>
      <SegmentedRow
        label={sizeLabel}
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
      <FieldRow label={edgeLabel} kind="segmented" disabled={!editable}>
        <SegmentedControl<DiagramZoomEdge>
          size="sm"
          aria-label={edgeLabel}
          value={controls.cutAvailable ? edge : 'whole'}
          disabled={!editable}
          options={[
            {
              value: 'cut',
              label: t('panels:diagram.annotations.enlargeCut', 'Cut'),
              disabled: !controls.cutAvailable,
              tooltip: controls.cutAvailable
                ? t('panels:diagram.annotations.enlargeCutHint', 'Draw the frame only where it crosses paper')
                : noOutline,
            },
            {
              value: 'whole',
              label: t('panels:diagram.annotations.enlargeWhole', 'Whole'),
              tooltip: t('panels:diagram.annotations.enlargeWholeHint', 'Draw the whole frame'),
            },
          ]}
          onChange={(next) => controls.setEdge(next)}
        />
      </FieldRow>
      {controls.anchorShown && (
        <DiagramAnchorRow
          label={t('panels:diagram.annotations.enlargeAnchor', 'Anchor')}
          picked={controls.picked}
          actions={controls.anchorActions}
          editable={editable}
          autoHint={t('panels:diagram.annotations.anchorAutoHint', 'The backmost face outside the frame')}
          pickedHint={t('panels:diagram.annotations.anchorPickedHint', 'The face picked on the canvas')}
        />
      )}
      <p className={styles.note} data-readout={controls.readout?.kind ?? 'size'} data-tone={controls.readout?.warn ? 'warning' : undefined}>
        {controls.readout
          ? zoomReadoutText(t, controls.readout, i18n.language)
          : scale === null
            ? t('panels:diagram.annotations.enlargeReadoutFill', 'Prints as large as its room allows, up to ×6 the area.')
            : t('panels:diagram.annotations.enlargeReadoutFixed', 'Prints at {{size}} × the area’s printed size.', {
                size: zoomNumber(scale, i18n.language),
              })}
      </p>
      {controls.on === 'frame' && (
        <p className={styles.note}>
          {controls.actions.length > 0
            ? t(
                'panels:diagram.annotations.frameNote',
                'Update Enlarged Steps on its area, or turning Enlarged off and on, places this frame again.'
              )
            : t('panels:diagram.annotations.frameNoteGone', 'Turning Enlarged off and on places this frame again.')}
        </p>
      )}
      {controls.actions.length > 0 && (
        <span className={styles.verbs}>
          {controls.actions.map((action) => (
            <DiagramZoomVerb key={action.id} action={action} />
          ))}
        </span>
      )}
    </div>
  );
}

/** A shape as its option draws it: a circle, or a rectangle with corners rounded as a frame's are. */
function ShapeMark({ shape }: { shape: DiagramZoomShape }) {
  return (
    <svg width={18} height={14} viewBox="0 0 18 14" aria-hidden="true">
      {shape === 'circle' ? (
        <circle cx={9} cy={7} r={5.5} fill="none" stroke="currentColor" strokeWidth={1.4} />
      ) : (
        <rect x={2} y={2.5} width={14} height={9} rx={2} fill="none" stroke="currentColor" strokeWidth={1.4} />
      )}
    </svg>
  );
}
