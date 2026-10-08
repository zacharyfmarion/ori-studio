import { useTranslation } from 'react-i18next';
import type { DiagramStepAction } from '../../diagram/actions/diagramActions';
import type { DiagramStep } from '../../diagram/document/diagramDocument';
import { useStepZoom } from '../../diagram/zoom/useStepZoom';
import { useZoomControls } from '../../diagram/zoom/useZoomControls';
import type { StepZoomStatus } from '../../diagram/zoom/zoomActions';
import { CollapsibleSection } from '../ui/CollapsibleSection';
import { Toggle } from '../ui/Toggle';
import { EnlargedAreaUpdate, EnlargedFromRow, HeldAreas, StepZoomNotices } from './DiagramStepZoomStatus';
import { ZoomAnchorRow, ZoomReadout, ZoomSizeRows } from './DiagramZoomRows';
import styles from './DiagramStepEnlarged.module.css';

/** The step's own frame, as the Layers pane's frame row binds it. */
const FRAME_TARGET = { kind: 'frame' } as const;

/**
 * Annotate's Enlarged section in the Step pane (Zach's review of #436,
 * 2026-10-08): the step's enlargement, where its area is drawn and its frame
 * moved. On every step, the Enlarged switch (`buildEnlargedAction`), refused
 * with its reason, on the section's heading — the heading is its name (review
 * fix 4). On an enlarged step, where its frame came from — a row that goes to
 * the area, selected on its step — and, when the area changed since, the
 * step's Update; its Size, with Fill, the frame's Anchor with Pick and Reset,
 * what it prints at, and its notices. On a step that holds an area, the steps
 * enlarged from it, and while any of them is out of date, which, and Update
 * All (`HeldAreas`).
 *
 * The rows are the Layers pane's frame rows, bound through the same hooks
 * (`useStepZoom`, `useZoomControls`): Layers' belong to the selected frame,
 * these to the step. Pose has none of this; it only draws the frame. Out of
 * the step detail the pane has the read-only `DiagramStepZoomStatus`.
 */
export function DiagramStepEnlarged({ step, actions }: { step: DiagramStep; actions: readonly DiagramStepAction[] }) {
  const { t } = useTranslation();
  const { enlarged, status, areas } = useStepZoom(step);
  if (!enlarged) return null;
  return (
    <CollapsibleSection
      title={t('panels:diagram.stepPane.enlarged', 'Enlarged')}
      action={
        // The row says why it is held, or what it does, as a switch's row does: a disabled switch shows no tooltip.
        <span className={styles.switch} title={enlarged.hint} data-enlarged-switch="">
          <Toggle
            aria-label={enlarged.label}
            checked={enlarged.pressed ?? false}
            disabled={enlarged.disabled}
            // Waiting for its capture, the switch refuses, as the verb does.
            onChange={() => enlarged.run()}
          />
        </span>
      }
    >
      <div className={styles.enlarged} data-step-enlarged="">
        {areas && <HeldAreas areas={areas} />}
        {status && <EnlargedFrame step={step} status={status} actions={actions} />}
      </div>
    </CollapsibleSection>
  );
}

/** An enlarged step's rows under the heading: From, its area's Update, Size, Anchor, the read-out and the notices. */
function EnlargedFrame({
  step,
  status,
  actions,
}: {
  step: DiagramStep;
  status: StepZoomStatus;
  actions: readonly DiagramStepAction[];
}) {
  const controls = useZoomControls(step, FRAME_TARGET);
  // Go to the area, selected on its step: the frame's own verb, as Layers offers it.
  const goToArea = controls.actions.find((action) => action.id === 'go-to-area');
  return (
    <>
      <EnlargedFromRow area={status.area} onGo={goToArea?.run} />
      <EnlargedAreaUpdate status={status} actions={actions} />
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
