import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ReactZoomPanPinchRef } from 'react-zoom-pan-pinch';
import { useViewportSurface } from '../../hooks/useViewportSurface';
import { getViewportFitScale } from '../../lib/designViewport';
import type { PlotRect } from '../../lib/geometry';
import { viewportSizeFromElement } from '../../lib/treeViewportPrimitives';
import { registerDiagramViewCamera } from '../useDiagramShortcuts';
import type { PreparedDiagramPages } from './diagramPages';

/** A page at 100% is its paper's size on a 96 dpi screen. */
export const PAGES_PX_PER_MM = 96 / 25.4;
/** The column's margin, the gap between pages and the caption under each, in CSS px. */
export const PAGES_PAD = 32;
export const PAGES_GAP = 28;
export const PAGES_CAPTION = 24;
/** How far a press may travel and still be a press, not a pan, in CSS px. */
const PAN_SLOP = 4;
const REVEAL_MS = 160;
const PAGE_TURN_MS = 220;

const OBSERVES = typeof IntersectionObserver !== 'undefined';

/**
 * The Pages view's behaviour (AGENTS.md › Panel components): its camera — the
 * BP panes' (`useViewportSurface`), registered with the Diagram's own viewport
 * keys — which page is in the middle of the view, which pages are near enough
 * to compose, the selected step brought into view and given the focus, and
 * whether a press was really the end of a pan.
 */
export function usePagesView({
  pages,
  selectedStepId,
  fitKey,
}: {
  pages: PreparedDiagramPages | null;
  selectedStepId: string | null;
  fitKey: string;
}) {
  const paper = pages?.layout.paper ?? null;
  const count = pages?.layout.pages.length ?? 0;
  const pageW = (paper?.widthMm ?? 210) * PAGES_PX_PER_MM;
  const pageH = (paper?.heightMm ?? 297) * PAGES_PX_PER_MM;
  const pitch = pageH + PAGES_CAPTION + PAGES_GAP;
  const worldRect = useMemo<PlotRect>(
    () => ({ x: 0, y: 0, width: pageW + 2 * PAGES_PAD, height: PAGES_PAD * 2 + Math.max(1, count) * pitch - PAGES_GAP }),
    [pageW, count, pitch]
  );
  // Framed on the first page, as a reader opens a book — and framed again
  // once the pages are first laid out, which is when their size is known.
  const fitRect = useMemo<PlotRect>(
    () => ({ x: 0, y: 0, width: pageW + 2 * PAGES_PAD, height: pageH + PAGES_CAPTION + 2 * PAGES_PAD }),
    [pageW, pageH]
  );
  const camera = useViewportSurface({
    surface: null,
    worldRect,
    fitRect,
    fitAnchor: 'fit-rect',
    fitKey: `${fitKey}:${pages ? 'laid-out' : 'waiting'}`,
  });
  const { containerRef, transformRef, handleViewportShortcut, onTransformed: cameraTransformed } = camera;
  useEffect(() => registerDiagramViewCamera(handleViewportShortcut), [handleViewportShortcut]);

  // The page in the middle of the view.
  const [current, setCurrent] = useState(0);
  const onTransformed = useCallback(
    (ref: ReactZoomPanPinchRef, state: { scale: number; positionY: number }) => {
      cameraTransformed(ref, state);
      const height = containerRef.current?.clientHeight ?? 0;
      const middle = (height / 2 - state.positionY) / state.scale;
      setCurrent(Math.min(Math.max(0, Math.floor((middle - PAGES_PAD) / pitch)), Math.max(0, count - 1)));
    },
    [cameraTransformed, containerRef, pitch, count]
  );

  /**
   * Turn to a page: frame it whole, its caption and the column's margin
   * included, as the view first frames page one — the Pages view as a pager,
   * which on a phone is how it is read.
   */
  const goToPage = useCallback(
    (index: number) => {
      const api = transformRef.current;
      const view = containerRef.current;
      if (!api || !view || count === 0) return;
      const viewport = viewportSizeFromElement(view);
      if (!viewport) return;
      const target = Math.min(Math.max(0, index), count - 1);
      const width = pageW + 2 * PAGES_PAD;
      const height = pageH + PAGES_CAPTION + 2 * PAGES_PAD;
      // The fit's own scale (`useViewportSurface`): a page turned to is framed as Fit frames page one.
      const scale = getViewportFitScale(viewport, { width, height });
      api.setTransform(
        (viewport.width - width * scale) / 2,
        (viewport.height - height * scale) / 2 - target * pitch * scale,
        scale,
        PAGE_TURN_MS
      );
    },
    [transformRef, containerRef, count, pageW, pageH, pitch]
  );

  // Pages are composed once they come within a view's height of the screen.
  const [near, setNear] = useState<ReadonlySet<number>>(() => new Set([0]));
  const pageElements = useRef(new Map<number, HTMLElement>());
  const pageRef = useCallback(
    (index: number) => (element: HTMLElement | null) => {
      if (element) pageElements.current.set(index, element);
      else pageElements.current.delete(index);
    },
    []
  );
  useEffect(() => {
    const root = containerRef.current;
    if (!root || !OBSERVES) return undefined;
    const observer = new IntersectionObserver(
      (entries) => {
        setNear((previous) => {
          let next: Set<number> | null = null;
          for (const entry of entries) {
            const index = Number((entry.target as HTMLElement).dataset.page);
            if (entry.isIntersecting && !previous.has(index)) (next ??= new Set(previous)).add(index);
          }
          return next ?? previous;
        });
      },
      { root, rootMargin: '100% 0px' }
    );
    for (const element of pageElements.current.values()) observer.observe(element);
    return () => observer.disconnect();
  }, [containerRef, count]);
  // Without an observer (a test's DOM), every page is near.
  const isNear = useCallback((index: number) => !OBSERVES || near.has(index), [near]);

  // The selected step: in view, and holding the focus while the focus is in
  // the pages or nowhere — as the Steps grid does — so Enter opens it and the
  // arrows move from it. Only when it changes, and when the pages first lay
  // out: an edit that relays them must not pull the camera from where the
  // reader panned.
  const cells = useRef(new Map<string, HTMLElement>());
  const cellRef = useCallback(
    (stepId: string) => (element: HTMLElement | null) => {
      if (element) cells.current.set(stepId, element);
      else cells.current.delete(stepId);
    },
    []
  );
  const shown = useRef<{ stepId: string | null; laidOut: boolean }>({ stepId: null, laidOut: false });
  useLayoutEffect(() => {
    const laidOut = pages !== null;
    const last = shown.current;
    if (selectedStepId === null || !laidOut || (last.stepId === selectedStepId && last.laidOut)) {
      shown.current = { stepId: selectedStepId, laidOut };
      return undefined;
    }
    shown.current = { stepId: selectedStepId, laidOut };
    // After the fit the pages' first layout asks for, which runs in the next frame.
    const frame = requestAnimationFrame(() => {
      const cell = cells.current.get(selectedStepId);
      const container = containerRef.current;
      const api = transformRef.current;
      if (!cell || !container) return;
      const active = document.activeElement;
      if ((active === null || active === document.body || container.contains(active)) && active !== cell) {
        cell.focus({ preventScroll: true });
      }
      if (!api) return;
      const view = container.getBoundingClientRect();
      const box = cell.getBoundingClientRect();
      const dx = box.left < view.left ? view.left - box.left : box.right > view.right ? view.right - box.right : 0;
      const dy = box.top < view.top ? view.top - box.top : box.bottom > view.bottom ? view.bottom - box.bottom : 0;
      if (dx === 0 && dy === 0) return;
      const { positionX, positionY, scale } = api.instance.transformState;
      api.setTransform(positionX + dx, positionY + dy, scale, REVEAL_MS);
    });
    return () => cancelAnimationFrame(frame);
  }, [selectedStepId, pages, containerRef, transformRef]);

  // A pan ends in a click on whatever was under the pointer: that click is the
  // pan's, not a choice of a step or a question about the page.
  const panStart = useRef<{ x: number; y: number } | null>(null);
  const panned = useRef(false);
  const onPanningStart = useCallback((ref: ReactZoomPanPinchRef) => {
    const { positionX, positionY } = ref.state;
    panStart.current = { x: positionX, y: positionY };
  }, []);
  const onPanningStop = useCallback((ref: ReactZoomPanPinchRef) => {
    const start = panStart.current;
    panStart.current = null;
    if (start && Math.hypot(ref.state.positionX - start.x, ref.state.positionY - start.y) > PAN_SLOP) {
      panned.current = true;
    }
  }, []);
  /** Whether a press is the end of a pan (or made while Space pans): to be ignored. Asking clears it. */
  const pressWasPan = useCallback(() => {
    const was = panned.current;
    panned.current = false;
    return was || camera.spacePressed;
  }, [camera.spacePressed]);

  return {
    ...camera,
    onTransformed,
    onPanningStart,
    onPanningStop,
    pressWasPan,
    current,
    count,
    goToPage,
    pageW,
    pageH,
    pitch,
    worldRect,
    isNear,
    pageRef,
    cellRef,
  };
}
