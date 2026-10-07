import { useWorkspaceStore } from '../../store/workspaceStore';
import { openDiagramStep } from '../useDiagramActions';

/**
 * Open the step an enlarge area is on in Annotate, the area selected
 * (Revision 2): what a double press on an enlarge arrow in the Pages view
 * does, from the arrow to what it leaves. False when the step is gone.
 */
export function openEnlargeArea(stepId: string, areaId: string): boolean {
  const opened = openDiagramStep(stepId, 'enlarge_arrow', 'annotate');
  if (opened) useWorkspaceStore.getState().selectDiagramAnnotation(areaId);
  return opened;
}
