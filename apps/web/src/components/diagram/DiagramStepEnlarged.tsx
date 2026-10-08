import { useTranslation } from 'react-i18next';
import type { DiagramStep } from '../../diagram/document/diagramDocument';
import { useStepZoom } from '../../diagram/zoom/useStepZoom';
import { useZoomControls } from '../../diagram/zoom/useZoomControls';
import type { StepZoomStatus } from '../../diagram/zoom/zoomActions';
import { CollapsibleSection } from '../ui/CollapsibleSection';
import { ToggleRow } from '../ui/fieldRows';
import { EnlargedFromRow, StepZoomNotices } from './DiagramStepZoomStatus';
import { ZoomAnchorRow, ZoomReadout, ZoomSizeRows } from './DiagramZoomRows';
import styles from './DiagramStepEnlarged.module.css';

/** The step's own frame, as the Layers pane's frame row binds it. */
const FRAME_TARGET = { kind: 'frame' } as const;

/**
 * Annotate's Enlarged section in the Step pane (Zach's review of #436,
 * 2026-10-08): the step's enlargement, where its area is drawn and its frame
 * moved. On every step, the Enlarged switch (`buildEnlargedAction`), refused
 * with its reason; on an enlarged step, where its frame came from — a row
 * that goes to the area, selected on its step — its Size, with Fill, the
 * frame's Anchor with Pick and Reset, what it prints at, and its notices.
 *
 * The rows are the Layers pane's frame rows, bound through the same hooks
 * (`useStepZoom`, `useZoomControls`): Layers' belong to the selected frame,
 * these to the step. Pose has none of this; it only draws the frame. Out of
 * the step detail the pane has the read-only `DiagramStepZoomStatus`.
 */
export function DiagramStepEnlarged({ step }: { step: DiagramStep }) {
  const { t } = useTranslation();
  const { enlarged, status } = useStepZoom(step);
  if (!enlarged) return null;
  return (
    <CollapsibleSection title={t('panels:diagram.stepPane.enlarged', 'Enlarged')}>
      <div className={styles.enlarged} data-step-enlarged="">
        <ToggleRow
          label={enlarged.label}
          checked={enlarged.pressed ?? false}
          disabled={enlarged.disabled}
          title={enlarged.hint}
          // Alone, the section's own rule ends it.
          divider={status !== null}
          // Waiting for its capture, the switch refuses, as the verb does.
          onChange={() => enlarged.run()}
        />
        {status && <EnlargedFrame step={step} status={status} />}
      </div>
    </CollapsibleSection>
  );
}

/** An enlarged step's rows under the switch: From, Size, Anchor, the read-out and the notices. */
function EnlargedFrame({ step, status }: { step: DiagramStep; status: StepZoomStatus }) {
  const controls = useZoomControls(step, FRAME_TARGET);
  // Go to the area, selected on its step: the frame's own verb, as Layers offers it.
  const goToArea = controls.actions.find((action) => action.id === 'go-to-area');
  return (
    <>
      <EnlargedFromRow areaStep={status.areaStep} onGo={goToArea?.run} />
      <ZoomSizeRows controls={controls} />
      <ZoomAnchorRow controls={controls} />
      <div className={styles.end}>
        <ZoomReadout controls={controls} />
        {status.notices.length > 0 && (
          <div className={styles.notices}>
            <StepZoomNotices notices={status.notices} />
          </div>
        )}
      </div>
    </>
  );
}
