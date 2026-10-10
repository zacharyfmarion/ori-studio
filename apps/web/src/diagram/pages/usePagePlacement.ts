import { printedFrameMm } from './pagePictures';
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { useIsPhoneSurface } from '../../platform/mobileSurface';
import { stepById, type DiagramDocument } from '../document/diagramDocument';
import { placementBlocker, placeOffset } from '../document/stepPlace';
import type { PreparedDiagramPages } from './diagramPages';
import type { LayoutCell } from './diagramPageLayout';
import { partBox, pageOffset, type PagePart } from './pagePlacement';
import { commitPlacement, commitZoomSize } from './placementActions';
import { previewPlacement } from './placementPreview';
import { registerPlacementKeys } from './placementGestures';

interface Draft {
  base: PreparedDiagramPages;
  cell: LayoutCell;
  part: PagePart;
  page: number;
  loadId: number;
  document: DiagramDocument;
  dx: number;
  dy: number;
  factor: number;
  source: 'drag' | 'keys';
  pending?: DiagramDocument;
  pointer?: {
    id: number;
    x: number;
    y: number;
    mmPerPx: number;
    target: HTMLElement;
    size: false | 'left' | 'middle' | 'right';
  };
  snap?: { auto?: boolean; number?: number };
}
const NUDGE_DELAY = 220;

/** Pointer and keyboard transactions live here; the view only places targets and previews. */
export function usePagePlacement(pages: PreparedDiagramPages | null, space: boolean) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const live = useRef<Draft | null>(null);
  const committing = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const phone = useIsPhoneSurface();
  const selected = useWorkspaceStore((state) => state.diagramSelectedStepId);
  const part = useWorkspaceStore((state) => state.diagramPagesPart);
  const readOnly = useWorkspaceStore((state) => state.diagramReadOnly);
  const update = (value: Draft | null) => {
    live.current = value;
    setDraft(value);
  };
  const drop = () => {
    if (!live.current || live.current.pending) return false;
    if (timer.current) clearTimeout(timer.current);
    update(null);
    return true;
  };
  const commit = () => {
    const current = live.current;
    if (!current || current.pending) return;
    const state = useWorkspaceStore.getState();
    if (state.diagramLoadId !== current.loadId || state.diagram !== current.document) {
      update(null);
      return;
    }
    const step = stepById(current.document, current.cell.stepId);
    if (!step) {
      update(null);
      return;
    }
    if (!current.dx && !current.dy && current.factor === 1) {
      update(null);
      return;
    }
    committing.current = true;
    let changed = false;
    if (current.pointer?.size) {
      const scale = current.cell.mmPerUnit ?? current.cell.frameMm;
      if (step.zoom)
        changed = commitZoomSize(
          step.id,
          Math.max(1.25, Math.min(6, (current.cell.zoom?.printed ?? step.zoom.scale ?? 1.25) * current.factor)),
          'drag',
          current.loadId,
        );
      else if (scale !== null) {
        const auto = current.cell.placed?.auto;
        const value = scale * current.factor;
        const autoScale = auto ? (auto.mmPerUnit ?? auto.frameMm) : scale;
        changed = commitPlacement(
          step.id,
          {
            scale:
              autoScale !== null && Math.abs(value / autoScale - 1) < 0.003
                ? null
                : current.cell.mmPerUnit !== null
                  ? { mmPerUnit: value }
                  : { frameMm: value },
          },
          'drag',
          { loadId: current.loadId },
        );
      }
    } else {
      const [x, y] = pageOffset(step.place, current.part, !!current.cell.rightToLeft);
      const offset: [number, number] = [x + current.dx, y + current.dy];
      if (current.part === 'frame' && current.cell.rightToLeft) offset[0] *= -1;
      changed = commitPlacement(step.id, { [current.part]: placeOffset(offset) }, current.source, {
        loadId: current.loadId,
      });
    }
    committing.current = false;
    if (changed) update({ ...current, pending: useWorkspaceStore.getState().diagram! });
    else update(null);
  };
  const make = (page: number, cell: LayoutCell, chosen: PagePart, source: Draft['source']): Draft | null => {
    const state = useWorkspaceStore.getState();
    const step = state.diagram && stepById(state.diagram, cell.stepId);
    if (
      !pages?.withLayout ||
      !state.diagram ||
      phone ||
      readOnly ||
      !step ||
      placementBlocker(step) ||
      (pages.document && pages.document !== state.diagram)
    )
      return null;
    return {
      base: pages,
      document: state.diagram,
      cell,
      part: chosen,
      page,
      loadId: state.diagramLoadId,
      dx: 0,
      dy: 0,
      factor: 1,
      source,
    };
  };
  useEffect(() => {
    const current = live.current;
    if (
      current?.pending &&
      (pages?.document === current.pending || useWorkspaceStore.getState().diagram !== current.pending)
    )
      update(null);
  }, [pages]);
  useEffect(
    () =>
      useWorkspaceStore.subscribe((next, previous) => {
        const current = live.current;
        if (!current) return;
        if (committing.current) return;
        if (
          next.diagramLoadId !== current.loadId ||
          next.diagramSelectedStepId !== current.cell.stepId ||
          next.diagramDetail !== null ||
          next.diagramView !== 'pages' ||
          (next.diagramPagesPart !== current.part && next.diagramPagesPart !== previous.diagramPagesPart) ||
          next.diagram !== previous.diagram
        ) {
          if (timer.current) clearTimeout(timer.current);
          update(null);
        }
      }),
    [],
  );
  useEffect(() =>
    registerPlacementKeys((id) => {
      if (id === 'diagram.placementUndo') return drop();
      if (!part || !selected || phone || readOnly) return false;
      if (id === 'diagram.placementDelete') return true;
      if (!id.startsWith('diagram.nudgePlacement')) return false;
      const page = pages?.layout.pages.findIndex((p) => p.cells.some((c) => c.stepId === selected)) ?? -1;
      const cell = pages?.layout.pages[page]?.cells.find((c) => c.stepId === selected);
      if (!cell) return false;
      let current = live.current;
      if (!current || current.pending) current = make(page, cell, part, 'keys');
      if (!current || current.pointer) return true;
      const distance = id.endsWith('Large') ? 5 : 0.5;
      const dx = id.includes('Left') ? -distance : id.includes('Right') ? distance : 0;
      const dy = id.includes('Up') ? -distance : id.includes('Down') ? distance : 0;
      update({ ...current, dx: current.dx + dx, dy: current.dy + dy });
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(commit, NUDGE_DELAY);
      return true;
    }, drop),
  );
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
      live.current = null;
    },
    [],
  );

  const start = (
    event: ReactPointerEvent<HTMLElement>,
    page: number,
    cell: LayoutCell,
    chosen: PagePart = 'frame',
    size: false | 'left' | 'middle' | 'right' = false,
  ) => {
    if (
      space ||
      event.button !== 0 ||
      (event.pointerType === 'touch' && (selected !== cell.stepId || (chosen !== 'frame' && part !== chosen)))
    )
      return;
    const element = event.currentTarget.closest<HTMLElement>('[data-page]');
    if (!element || !pages) return;
    const rect = element.getBoundingClientRect(),
      mmPerPx = pages.layout.paper.widthMm / rect.width;
    if (chosen === 'frame' && (event.metaKey || event.ctrlKey)) {
      const x = (event.clientX - rect.left) * mmPerPx,
        y = (event.clientY - rect.top) * mmPerPx;
      chosen =
        (['number', 'picture', 'text'] as const).find((part) => {
          const box = partBox(cell, part);
          return x >= box.x && x <= box.x + box.w && y >= box.y && y <= box.y + box.h;
        }) ?? 'frame';
    }
    const current = make(page, cell, chosen, 'drag');
    if (!current) return;
    event.preventDefault();
    event.stopPropagation();
    const state = useWorkspaceStore.getState();
    state.selectDiagramStep(cell.stepId);
    if (chosen !== 'frame') state.selectDiagramPagesPart(chosen);
    event.currentTarget.setPointerCapture(event.pointerId);
    current.pointer = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      mmPerPx: current.base.layout.paper.widthMm / element.getBoundingClientRect().width,
      target: event.currentTarget,
      size,
    };
    update(current);
  };
  const move = (event: ReactPointerEvent<HTMLElement>) => {
    const current = live.current,
      pointer = current?.pointer;
    if (!current || !pointer || pointer.id !== event.pointerId || current.pending) return;
    const dx = (event.clientX - pointer.x) * pointer.mmPerPx,
      dy = (event.clientY - pointer.y) * pointer.mmPerPx;
    if (Math.hypot(dx, dy) < 4 * pointer.mmPerPx && current.dx === 0 && current.dy === 0 && current.factor === 1)
      return;
    event.preventDefault();
    event.stopPropagation();
    useWorkspaceStore.getState().selectDiagramPagesPart(current.part);
    const box = partBox(current.cell, current.part),
      paper = current.base.layout.paper;
    if (pointer.size) {
      const step = stepById(current.document, current.cell.stepId)!;
      const sizeOf = (cell: LayoutCell) => {
        const step = stepById(current.document, cell.stepId);
        return step ? printedFrameMm(step, current.document.assets, current.document.style, cell) : null;
      };
      const max =
          printedFrameMm(step, current.document.assets, current.document.style, current.cell) ?? Math.max(box.w, box.h),
        near = 6 * pointer.mmPerPx;
      const horizontal = (dx * (pointer.size === 'left' ? -2 : 2)) / box.w;
      const vertical = dy / box.h;
      const change = pointer.size === 'middle' || Math.abs(vertical) > Math.abs(horizontal) ? vertical : horizontal;
      let mm = Math.max(4, Math.min(Math.max(paper.widthMm, paper.heightMm) - paper.marginMm * 2, max * (1 + change)));
      let snap: Draft['snap'];
      if (!event.altKey) {
        const auto = current.cell.placed?.auto;
        const scale = current.cell.mmPerUnit ?? current.cell.frameMm;
        const candidates: { mm: number; auto?: boolean; number?: number }[] = [
          { mm: auto && scale ? (max * (auto.mmPerUnit ?? auto.frameMm ?? scale)) / scale : max, auto: true },
        ];
        for (const cell of current.base.layout.pages[current.page]!.cells) {
          if (
            cell.stepId === current.cell.stepId ||
            !!cell.zoom !== !!current.cell.zoom ||
            (cell.mmPerUnit !== null) !== (current.cell.mmPerUnit !== null)
          )
            continue;
          const value = sizeOf(cell);
          if (value !== null) candidates.push({ mm: value, number: cell.number });
        }
        const closest = candidates.sort((a, b) => Math.abs(a.mm - mm) - Math.abs(b.mm - mm))[0];
        if (closest && Math.abs(closest.mm - mm) < near) {
          mm = closest.mm;
          snap = closest;
        }
      }
      if (current.cell.zoom) {
        const printed = current.cell.zoom.printed;
        mm = (max * Math.max(1.25, Math.min(6, (printed * mm) / max))) / printed;
      }
      update({ ...current, factor: mm / max, snap });
      return;
    }
    let x = dx,
      y = dy;
    if (event.shiftKey) {
      if (Math.abs(x) > Math.abs(y)) y = 0;
      else x = 0;
    }
    if (!event.altKey) {
      const step = stepById(current.document, current.cell.stepId)!;
      const home = pageOffset(step.place, current.part, !!current.cell.rightToLeft);
      const near = 6 * pointer.mmPerPx;
      const candidatesX = [-home[0]],
        candidatesY = [-home[1]];
      for (const other of current.base.layout.pages[current.page]!.cells)
        if (other.stepId !== current.cell.stepId) {
          const b = partBox(other, current.part);
          candidatesX.push(b.x - box.x, b.x + b.w / 2 - box.x - box.w / 2, b.x + b.w - box.x - box.w);
          candidatesY.push(b.y - box.y, b.y + b.h / 2 - box.y - box.h / 2, b.y + b.h - box.y - box.h);
        }
      const snap = (value: number, candidates: number[]) => {
        const best = candidates.sort((a, b) => Math.abs(a - value) - Math.abs(b - value))[0];
        return best !== undefined && Math.abs(best - value) < near ? best : value;
      };
      x = snap(x, candidatesX);
      y = snap(y, candidatesY);
    }
    if (event.shiftKey) {
      if (Math.abs(dx) > Math.abs(dy)) y = 0;
      else x = 0;
    }
    x = Math.max(-box.x, Math.min(paper.widthMm - box.x - box.w, x));
    y = Math.max(-box.y, Math.min(paper.heightMm - box.y - box.h, y));
    update({ ...current, dx: x, dy: y });
  };
  const end = (event: ReactPointerEvent<HTMLElement>) => {
    if (live.current?.pointer?.id !== event.pointerId) return;
    event.stopPropagation();
    commit();
  };
  const preview =
    draft?.base.withLayout?.(
      previewPlacement(draft.base.layout, draft.cell.stepId, draft.part, draft.dx, draft.dy, draft.factor),
    ) ?? null;
  return {
    pages: preview ?? pages,
    draft,
    selected,
    part,
    enabled: !phone && !readOnly,
    start,
    move,
    end,
    cancel: drop,
  };
}
