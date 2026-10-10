import { useWorkspaceStore } from '../../store/workspaceStore';
import type { DiagramStep } from '../document/diagramDocument';
import { placementBlocker } from '../document/stepPlace';
import { printedFrameMm } from './pagePictures';
import { pageOffset, type PagePart } from './pagePlacement';
import { commitPlacement, resetPlacement } from './placementActions';
import { usePrintedLayout } from './printedFrames';

export function useStepPlacement(step: DiagramStep) {
  const { pages, document } = usePrintedLayout();
  const currentDocument = useWorkspaceStore((state) => state.diagram);
  const cell =
    document === currentDocument
      ? (pages?.layout.pages.flatMap((page) => page.cells).find((each) => each.stepId === step.id) ?? null)
      : null;
  const selected = useWorkspaceStore((state) =>
    state.diagramSelectedStepId === step.id ? state.diagramPagesPart : null,
  );
  const readOnly = useWorkspaceStore((state) => state.diagramReadOnly);
  const loadId = useWorkspaceStore((state) => state.diagramLoadId);
  const blocked = placementBlocker(step);
  const size = cell && document ? printedFrameMm(step, document.assets, document.style, cell) : null;
  const auto = cell?.placed?.auto;
  const autoSize =
    cell && document && auto ? printedFrameMm(step, document.assets, document.style, { ...cell, ...auto }) : size;
  return {
    cell,
    selected,
    size,
    autoSize,
    readOnly,
    blocked,
    disabled: readOnly || blocked !== null || !cell,
    select(part: PagePart) {
      useWorkspaceStore.getState().selectDiagramPagesPart(part);
    },
    offset(part: PagePart) {
      return pageOffset(step.place, part, cell?.rightToLeft ?? false);
    },
    setOffset(part: PagePart, axis: 0 | 1, value: number) {
      const offset: [number, number] = [...(step.place?.[part] ?? [0, 0])];
      offset[axis] = part === 'frame' && axis === 0 && cell?.rightToLeft ? -value : value;
      commitPlacement(step.id, { [part]: offset }, 'pane', { loadId });
    },
    setSize(mm: number) {
      if (!cell || !size || step.zoom) return;
      if (autoSize !== null && Math.abs(mm - autoSize) < 0.05) {
        resetPlacement(step.id, 'scale');
        return;
      }
      const factor = mm / size;
      commitPlacement(
        step.id,
        {
          scale:
            cell.mmPerUnit !== null
              ? { mmPerUnit: cell.mmPerUnit * factor }
              : { frameMm: (cell.frameMm ?? size) * factor },
        },
        'pane',
        { loadId },
      );
    },
    reset: (part: Parameters<typeof resetPlacement>[1]) => resetPlacement(step.id, part),
  };
}
