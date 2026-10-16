import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ReactZoomPanPinchRef } from 'react-zoom-pan-pinch';
import { useViewportSurface, type KeptCamera } from '../../hooks/useViewportSurface';
import type { ViewportShortcutId } from '../../keyboard/shortcuts';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { getViewportFitScale } from '../../lib/designViewport';
import type { PlotRect } from '../../lib/geometry';
import { viewportSizeFromElement } from '../../lib/treeViewportPrimitives';
import { registerDiagramViewCamera } from '../useDiagramShortcuts';
import type { PreparedDiagramPages } from './diagramPages';
import { usePublishPageInView } from './pageInView';

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
/** The camera's fit time (`useViewportSurface`), for Fit on the page the reader is on. */
const PAGE_FIT_MS = 180;

/** The page in the middle of the view, and the first and last on screen, from 0. */
type OnScreen = { middle: number; first: number; last: number };
const NONE_ON_SCREEN: OnScreen = { middle: 0, first: 0, last: 0 };

/**
 * The Pages view's behaviour (AGENTS.md › Panel components): its camera — the
 * BP panes' (`useViewportSurface`), registered with the Diagram's own viewport
 * keys, its Fit the page the reader is on — which page is in the middle of the view, which are on screen and
 * which was last pressed (published for the panes, `pageInView.ts`), which
 * pages are near enough
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
  const observes = typeof IntersectionObserver !== 'undefined';
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
  // Where the reader left the pages — a step opened in Pose or Annotate, or the
  // Steps view chosen, unmounts this view — to come back to, not to page 1:
  // the camera, the pages it had on screen (so the panes and the pages' images
  // are this page's from the first frame), and the step it showed, which needs
  // no bringing into view again.
  const viewKey = `${fitKey}:${pages ? 'laid-out' : 'waiting'}`;
  const [kept] = useState(() => useWorkspaceStore.getState().diagramPagesCamera);
  const restoring = kept?.key === viewKey ? kept : null;
  const restoredShows = useRef(restoring?.shownStepId ?? null);
  // The selected step once brought into view: what a frame shows, and the view hands back as it leaves.
  const shown = useRef<{ stepId: string | null; laidOut: boolean }>({ stepId: null, laidOut: false });
  const onScreenRef = useRef<OnScreen>(restoring?.onScreen ?? NONE_ON_SCREEN);
  const onLeave = useCallback(
    (camera: KeptCamera) =>
      useWorkspaceStore.getState().keepDiagramPagesCamera({
        ...camera,
        shownStepId: shown.current.laidOut ? shown.current.stepId : null,
        onScreen: onScreenRef.current,
      }),
    []
  );
  const camera = useViewportSurface({
    surface: null,
    worldRect,
    fitRect,
    fitAnchor: 'fit-rect',
    fitKey: viewKey,
    keptCamera: kept,
    onLeave,
  });
  const {
    containerRef,
    transformRef,
    handleViewportShortcut: cameraShortcut,
    fitToView: fitWorld,
    onTransformed: cameraTransformed,
  } = camera;

  // The page in the middle of the view and the pages on screen, and the page
  // last pressed, for the panes too once the pages are laid out (`pageInView.ts`):
  // held to the pages there are, which a re-cut can make fewer.
  const [onScreen, setOnScreen] = useState<OnScreen>(() => restoring?.onScreen ?? NONE_ON_SCREEN);
  const [pressed, setPressed] = useState<{ page: number; selection: string | null } | null>(null);
  const lastPage = Math.max(0, count - 1);
  const current = Math.min(onScreen.middle, lastPage);
  const first = Math.min(onScreen.first, lastPage);
  const lastShown = Math.min(onScreen.last, lastPage);
  // A press stands while its page is on screen and the selection is what the press left.
  const pressedPage =
    pressed && pressed.selection === selectedStepId && pressed.page >= first && pressed.page <= lastShown
      ? pressed.page
      : null;
  const view = useMemo(
    () => (pages ? { middle: current, first, last: lastShown, pressed: pressedPage } : null),
    [pages, current, first, lastShown, pressedPage]
  );
  usePublishPageInView(view);
  const onTransformed = useCallback(
    (ref: ReactZoomPanPinchRef, state: { scale: number; positionY: number }) => {
      cameraTransformed(ref, state);
      const height = containerRef.current?.clientHeight ?? 0;
      const top = -state.positionY / state.scale;
      const bottom = (height - state.positionY) / state.scale;
      const clamp = (index: number) => Math.min(Math.max(0, index), Math.max(0, count - 1));
      // A page is on screen from its top edge, PAGES_PAD + index × pitch, to its bottom, pageH below.
      const next = {
        middle: clamp(Math.floor(((top + bottom) / 2 - PAGES_PAD) / pitch)),
        first: clamp(Math.floor((top - PAGES_PAD - pageH) / pitch) + 1),
        last: clamp(Math.ceil((bottom - PAGES_PAD) / pitch) - 1),
      };
      onScreenRef.current = next;
      setOnScreen((previous) =>
        previous.middle === next.middle && previous.first === next.first && previous.last === next.last ? previous : next
      );
    },
    [cameraTransformed, containerRef, pitch, pageH, count]
  );
  /** A press on page `index` — its paper, or a step or turn on it — leaving `selection` selected: "this page" for the panes. */
  const pressPage = useCallback((index: number, selection: string | null) => setPressed({ page: index, selection }), []);

  /**
   * Turn to a page: frame it whole, its caption and the column's margin
   * included, as the view first frames page one — the Pages view as a pager,
   * which on a phone is how it is read.
   */
  const goToPage = useCallback(
    (index: number, animationTime = PAGE_TURN_MS) => {
      const api = transformRef.current;
      const view = containerRef.current;
      if (!api || !view || count === 0) return;
      const viewport = viewportSizeFromElement(view);
      if (!viewport) return;
      const target = Math.min(Math.max(0, index), count - 1);
      const width = pageW + 2 * PAGES_PAD;
      const height = pageH + PAGES_CAPTION + 2 * PAGES_PAD;
      // The fit's own scale (`useViewportSurface`): a page turned to is framed as the first fit frames page one.
      const scale = getViewportFitScale(viewport, { width, height });
      api.setTransform(
        (viewport.width - width * scale) / 2,
        (viewport.height - height * scale) / 2 - target * pitch * scale,
        scale,
        animationTime
      );
    },
    [transformRef, containerRef, count, pageW, pageH, pitch]
  );

  /**
   * Fit, by the bar or the keys: the page the reader is on — the pager's — as
   * a turn to it frames it. Only the fit as the view opens frames page one
   * (`useViewportSurface`); before there are pages, Fit is the camera's.
   */
  const fitToView = useCallback(
    // A control hands its click event in as the first argument; only a number is a duration.
    (animationTime?: unknown) => {
      const time = typeof animationTime === 'number' ? animationTime : PAGE_FIT_MS;
      if (count === 0) fitWorld(time);
      else goToPage(current, time);
    },
    [count, current, fitWorld, goToPage]
  );
  const handleViewportShortcut = useCallback(
    (id: ViewportShortcutId) => {
      if (id !== 'viewport.fit') return cameraShortcut(id);
      fitToView();
      return true;
    },
    [fitToView, cameraShortcut]
  );
  useEffect(() => registerDiagramViewCamera(handleViewportShortcut), [handleViewportShortcut]);

  // Pages are composed once they come within a view's height of the screen:
  // the first, or the ones round those a view coming back had on screen.
  // Release their artwork and targets when they leave that area. The view keeps
  // the selected page's targets mounted for keyboard reveal and pointer capture.
  const [near, setNear] = useState<ReadonlySet<number>>(() => {
    if (!restoring) return new Set([0]);
    const { first: from, last: to } = restoring.onScreen;
    return new Set(Array.from({ length: to - from + 3 }, (_, k) => from - 1 + k).filter((index) => index >= 0));
  });
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
    if (!root || !observes) return undefined;
    const observer = new IntersectionObserver(
      (entries) => {
        setNear((previous) => {
          let next: Set<number> | null = null;
          for (const entry of entries) {
            const index = Number((entry.target as HTMLElement).dataset.page);
            const has = (next ?? previous).has(index);
            if (entry.isIntersecting && !has) (next ??= new Set(previous)).add(index);
            if (!entry.isIntersecting && has) (next ??= new Set(previous)).delete(index);
          }
          return next ?? previous;
        });
      },
      { root, rootMargin: '100% 0px' }
    );
    for (const element of pageElements.current.values()) observer.observe(element);
    return () => observer.disconnect();
  }, [containerRef, count, observes]);
  // Without an observer (a test's DOM), every page is near.
  const isNear = useCallback((index: number) => !observes || near.has(index), [near, observes]);

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
  useLayoutEffect(() => {
    const laidOut = pages !== null;
    if (selectedStepId === null || !laidOut) {
      shown.current = { stepId: selectedStepId, laidOut };
      return undefined;
    }
    const last = shown.current;
    if (last.stepId === selectedStepId && last.laidOut) return undefined;
    // After the fit the pages' first layout asks for, which runs in the next
    // frame. Shown once that frame runs, not before: new pages landing first
    // cancel it, and must not leave the step unshown — as a view coming back
    // from Pose with a relayout under way did.
    const frame = requestAnimationFrame(() => {
      shown.current = { stepId: selectedStepId, laidOut: true };
      // Put back where the reader left it with this step selected, the view shows it as it did: focus, no scroll.
      const restored = restoredShows.current === selectedStepId;
      restoredShows.current = null;
      const cell = cells.current.get(selectedStepId);
      const container = containerRef.current;
      const api = transformRef.current;
      if (!cell || !container) return;
      const active = document.activeElement;
      if ((active === null || active === document.body || container.contains(active)) && active !== cell) {
        cell.focus({ preventScroll: true });
      }
      if (!api || restored) return;
      const view = container.getBoundingClientRect();
      const box = cell.getBoundingClientRect();
      const dx = box.left < view.left ? view.left - box.left : box.right > view.right ? view.right - box.right : 0;
      const dy = box.top < view.top ? view.top - box.top : box.bottom > view.bottom ? view.bottom - box.bottom : 0;
      if (dx === 0 && dy === 0) return;
      const { positionX, positionY, scale } = api.instance.transformState;
      // A view just put on screen jumps there, as its fit does: the library's
      // first measure of it cancels any animation under way.
      api.setTransform(positionX + dx, positionY + dy, scale, last.laidOut ? REVEAL_MS : 0);
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
    fitToView,
    handleViewportShortcut,
    onTransformed,
    onPanningStart,
    onPanningStop,
    pressWasPan,
    pressPage,
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
