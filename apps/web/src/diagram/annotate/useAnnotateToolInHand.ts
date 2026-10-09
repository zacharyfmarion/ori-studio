import { useWorkspaceStore } from '../../store/workspaceStore';
import { annotateToolInHand } from '../../store/workspaceStore/diagramState';
import type { DiagramStep } from '../document/diagramDocument';
import { useXRayStanding } from '../xray/useXRayStanding';
import type { AnnotateTool } from './annotateTools';

/**
 * The Annotate tool in hand on `step` (`annotateToolInHand`): the one picked,
 * but Select where the step holds it — an Enlarge tool on an enlarged step,
 * the X-Ray tool where the step's x-ray standing holds it, read as the rail
 * reads it (`useXRayStanding`, its link included). What the rail shows
 * pressed, the canvas presses with and the tool window speaks of: one answer
 * (review of 18e).
 */
export function useAnnotateToolInHand(step: DiagramStep): AnnotateTool {
  const xray = useXRayStanding(step);
  return useWorkspaceStore((state) => annotateToolInHand(state, xray));
}
