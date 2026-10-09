import { useTranslation } from 'react-i18next';
import { xrayDepthWithin, XRAY_DEPTH } from '../../diagram/annotate/annotationModel';
import { useFieldFocusRequest } from '../../diagram/annotate/useFieldFocusRequest';
import type { DiagramStep, KnownDiagramAnnotation } from '../../diagram/document/diagramDocument';
import { useXRayControls } from '../../diagram/xray/useXRayControls';
import { NumberRow } from '../ui/fieldRows';
import { Notice } from '../ui/Notice';
import { DiagramAnchorRow } from './DiagramAnchorRow';
import styles from './DiagramXRayControls.module.css';

/**
 * An x-ray's own rows in the Layers pane (Revision 3): Depth — how many
 * layers it peels away inside its window (18g), which takes the focus for a
 * window just laid, so its count is typed and Enter gives the canvas its keys
 * back, as equal divisions' Parts does — with a notice when the window has
 * fewer than it asks for, which then draws at the deepest, or none to take
 * away; and the Point row, where peeling starts: Auto, the window's centre, or
 * a point picked on the canvas. On a picture with no layers to x-ray, or one
 * that needs a Refresh first, the rows are held and say why (R3-18b A). Each
 * change is one undo step (`useXRayControls`).
 */
export function DiagramXRayControls({ step, annotation }: { step: DiagramStep; annotation: KnownDiagramAnnotation }) {
  const { t } = useTranslation();
  const controls = useXRayControls(step, annotation);
  const depth = useFieldFocusRequest<HTMLInputElement>(annotation.id, 'depth');
  return (
    <>
      <NumberRow
        label={t('panels:diagram.annotations.xRayDepth', 'Depth')}
        value={controls.depth}
        min={XRAY_DEPTH.min}
        max={controls.max}
        disabled={!controls.editable}
        title={controls.held ?? undefined}
        normalize={xrayDepthWithin}
        fieldRef={depth}
        onCommit={controls.setDepth}
      />
      {controls.held !== null && (
        <div className={styles.notice} data-x-ray-held="">
          <Notice>{controls.held}</Notice>
        </div>
      )}
      {controls.empty && (
        <div className={styles.notice} data-x-ray-empty="">
          <Notice>{t('panels:diagram.annotations.xRayNothing', 'Nothing to take away in this window')}</Notice>
        </div>
      )}
      {controls.fewer !== null && (
        <div className={styles.notice} data-x-ray-fewer="">
          <Notice>
            {t('panels:diagram.annotations.xRayFewer', 'Only {{count}} layers to take away here', {
              count: controls.fewer,
              defaultValue_one: 'Only {{count}} layer to take away here',
            })}
          </Notice>
        </div>
      )}
      {controls.anchorShown && (
        <DiagramAnchorRow
          label={t('panels:diagram.annotations.xRayAnchor', 'Point')}
          picked={controls.picked}
          actions={controls.anchorActions}
          editable={controls.editable}
          autoHint={t('panels:diagram.annotations.xRayAnchorAutoHint', 'The window’s centre')}
          pickedHint={t('panels:diagram.annotations.xRayAnchorPickedHint', 'The point picked on the canvas')}
        />
      )}
    </>
  );
}
