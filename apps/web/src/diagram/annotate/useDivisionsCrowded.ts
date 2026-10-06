import { useMemo } from 'react';
import { DEFAULT_PAPER_SIZE_MM } from '../../lib/paper/paperPage';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { DEFAULT_DIAGRAM_STYLE, type DiagramAsset, type DiagramStep, type KnownDiagramAnnotation } from '../document/diagramDocument';
import { usePrintedFrameMm } from '../pages/printedFrames';
import { viewFrame, viewOfStep } from '../zoom/stepView';
import { divisionsCrowded } from './annotationPrimitives';

const NO_ASSETS: Readonly<Record<string, DiagramAsset>> = {};

/**
 * Whether equal divisions on `step` crowd as they print (ED10): measured at
 * the size the pages print the step's picture (`printedFrames.ts`), or at the
 * size every picture opens at — the canvas's and a card's — before the pages
 * are laid out.
 */
export function useDivisionsCrowded(step: DiagramStep, annotation: KnownDiagramAnnotation): boolean {
  const assets = useWorkspaceStore((state) => state.diagram?.assets ?? NO_ASSETS);
  const style = useWorkspaceStore((state) => state.diagram?.style ?? DEFAULT_DIAGRAM_STYLE);
  const printed = usePrintedFrameMm(step.id);
  return useMemo(() => {
    // The frame the marks are measured in: an enlarged step's window (Revision 2).
    const frame = viewFrame(viewOfStep(step), assets);
    return frame !== null && divisionsCrowded(annotation, frame, printed ?? DEFAULT_PAPER_SIZE_MM, style);
  }, [step, assets, annotation, printed, style]);
}
