import { useTranslation } from 'react-i18next';
import type { DiagramStep, DiagramZoomEdge, DiagramZoomShape } from '../../diagram/document/diagramDocument';
import { useZoomControls, type ZoomControlsTarget } from '../../diagram/zoom/useZoomControls';
import { FieldRow } from '../ui/fieldRows';
import { SegmentedControl } from '../ui/SegmentedControl';
import { ZoomAnchorRow, ZoomNote, ZoomReadout, ZoomSizeRows, ZoomVerb } from './DiagramZoomRows';
import styles from './DiagramZoomControls.module.css';

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
 * one undo step (`useZoomControls`). Size, the Anchor row and the read-out
 * are the rows Annotate's Step pane draws for the step's frame too
 * (`DiagramZoomRows`).
 */
export function DiagramZoomControls({ step, target }: { step: DiagramStep; target: ZoomControlsTarget }) {
  const { t } = useTranslation();
  const controls = useZoomControls(step, target);
  const { editable, shape, edge } = controls;
  const shapeLabel = t('panels:diagram.annotations.enlargeShape', 'Shape');
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
      <ZoomSizeRows controls={controls} />
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
      <ZoomAnchorRow controls={controls} />
      <ZoomReadout controls={controls} />
      {controls.on === 'frame' && (
        <ZoomNote>
          {controls.actions.length > 0
            ? t(
                'panels:diagram.annotations.frameNote',
                'Update Enlarged Steps on its area, or turning Enlarged off and on, places this frame again.'
              )
            : t('panels:diagram.annotations.frameNoteGone', 'Turning Enlarged off and on places this frame again.')}
        </ZoomNote>
      )}
      {controls.actions.length > 0 && (
        <span className={styles.verbs}>
          {controls.actions.map((action) => (
            <ZoomVerb key={action.id} action={action} />
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
