import { useMemo } from 'react';
import { useWorkspaceStore } from '../../store/workspaceStore';
import type { XRayStanding } from '../annotate/annotateTools';
import { linkStatusNow, useDiagramLinkStatuses } from '../capture/useLinkStatus';
import { stepNumber, type DiagramStep } from '../document/diagramDocument';
import { xrayStanding } from './xrayStanding';

/** {@link xrayStanding} for the step on screen, as its link's status and the open pattern change. */
export function useXRayStanding(step: DiagramStep): XRayStanding {
  const statuses = useDiagramLinkStatuses(useMemo(() => [step], [step]));
  const link = statuses.get(step.id) ?? null;
  const patternOpen = useWorkspaceStore((state) => state.oristudioCpDocument !== null);
  const number = useWorkspaceStore((state) => (state.diagram ? stepNumber(state.diagram, step.id) : null)) ?? 0;
  return useMemo(() => xrayStanding(step, { link, patternOpen, number }), [step, link, patternOpen, number]);
}

/** {@link xrayStanding} as it can be told right now, for a surface that asks at the moment it acts (a key press). */
export function xrayStandingNow(step: DiagramStep): XRayStanding {
  const { diagram, oristudioCpDocument } = useWorkspaceStore.getState();
  return xrayStanding(step, {
    link: linkStatusNow(step),
    patternOpen: oristudioCpDocument !== null,
    number: (diagram && stepNumber(diagram, step.id)) ?? 0,
  });
}
