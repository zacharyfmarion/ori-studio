import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { TransformComponent, TransformWrapper, type ReactZoomPanPinchRef } from 'react-zoom-pan-pinch';
import { useViewportSurface, VIEWPORT_PINCH_ZOOM, VIEWPORT_WHEEL_ZOOM } from '../../hooks/useViewportSurface';
import type { PlotRect } from '../../lib/geometry';
import { useIsCoarsePointerSurface } from '../../platform/pointerSurface';
import { stepHasPicture, type DiagramStep } from '../../diagram/document/diagramDocument';
import type { PreparedDiagramPages } from '../../diagram/pages/diagramPages';
import { composedPageUrl } from '../../diagram/pages/useDiagramPages';
import { registerDiagramViewCamera } from '../../diagram/useDiagramShortcuts';
import { ViewportToolbar } from '../panels/ViewportToolbar';
import styles from './DiagramPagesView.module.css';

/** A page at 100% is its paper's size on a 96 dpi screen. */
const PX_PER_MM = 96 / 25.4;
const PAD = 32;
const GAP = 28;
const CAPTION = 24;
const OBSERVES = typeof IntersectionObserver !== 'undefined';

/**
 * The Pages view (D10): each page as it will print, composed into an SVG and
 * shown as an `<img>`, so what the screen shows is the file. Pages are
 * composed as they come near the view, not all at once.
 *
 * Over each page, and never in it: the margin guide, a box for a step with no
 * picture yet, a mark where an instruction was cut, and the selection. A press
 * on a step selects it, a double press opens it; a press elsewhere on a page
 * is a question about the page, which brings the Page tab forward.
 *
 * The camera is the BP panes' (`useViewportSurface`), registered with the
 * Diagram's own viewport keys rather than in their place.
 */
export function DiagramPagesView({
  pages,
  failed,
  steps,
  selectedStepId,
  fitKey,
  onSelect,
  onOpen,
  onPageClick,
}: {
  pages: PreparedDiagramPages | null;
  failed: boolean;
  steps: readonly DiagramStep[];
  selectedStepId: string | null;
  /** What counts as a new set of pages to frame: a new diagram, or new paper. */
  fitKey: string;
  onSelect: (stepId: string) => void;
  onOpen: (stepId: string) => void;
  onPageClick: () => void;
}) {
  const { t } = useTranslation();
  const coarse = useIsCoarsePointerSurface();
  const paper = pages?.layout.paper ?? null;
  const count = pages?.layout.pages.length ?? 0;
  const pageW = (paper?.widthMm ?? 210) * PX_PER_MM;
  const pageH = (paper?.heightMm ?? 297) * PX_PER_MM;
  const pitch = pageH + CAPTION + GAP;
  const worldRect = useMemo<PlotRect>(
    () => ({ x: 0, y: 0, width: pageW + 2 * PAD, height: PAD * 2 + Math.max(1, count) * pitch - GAP }),
    [pageW, count, pitch]
  );
  // Framed on the first page, as a reader opens a book.
  const fitRect = useMemo<PlotRect>(() => ({ x: 0, y: 0, width: pageW + 2 * PAD, height: pageH + CAPTION + 2 * PAD }), [pageW, pageH]);
  const {
    containerRef,
    transformRef,
    zoomPercent,
    spacePressed,
    zoomIn,
    zoomOut,
    fitToView,
    setZoomLevel,
    handleViewportShortcut,
    onInit,
    onTransformed: cameraTransformed,
  } = useViewportSurface({ surface: null, worldRect, fitRect, fitAnchor: 'fit-rect', fitKey });
  useEffect(() => registerDiagramViewCamera(handleViewportShortcut), [handleViewportShortcut]);

  // Which page is in the middle of the view, for "Page n of m".
  const [current, setCurrent] = useState(0);
  const onTransformed = useCallback(
    (ref: ReactZoomPanPinchRef, state: { scale: number; positionY: number }) => {
      cameraTransformed(ref, state);
      const height = containerRef.current?.clientHeight ?? 0;
      const middle = (height / 2 - state.positionY) / state.scale;
      setCurrent(Math.min(Math.max(0, Math.floor((middle - PAD) / pitch)), Math.max(0, count - 1)));
    },
    [cameraTransformed, containerRef, pitch, count]
  );

  // Pages are composed once they come within a view's height of the screen.
  const [near, setNear] = useState<ReadonlySet<number>>(() => new Set([0]));
  const pageRefs = useRef(new Map<number, HTMLDivElement>());
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
    for (const element of pageRefs.current.values()) observer.observe(element);
    return () => observer.disconnect();
  }, [containerRef, count]);

  // Without an observer (a test's DOM), every page is near.
  const isNear = (index: number) => !OBSERVES || near.has(index);
  const stepsById = useMemo(() => new Map(steps.map((step) => [step.id, step])), [steps]);
  const mm = (value: number) => value * PX_PER_MM;

  const onCellClick = (event: MouseEvent, stepId: string) => {
    event.stopPropagation();
    onSelect(stepId);
  };

  return (
    <div
      ref={containerRef}
      className={styles.view}
      data-space-pan={spacePressed || undefined}
      tabIndex={-1}
    >
      <TransformWrapper
        ref={transformRef}
        initialScale={1}
        minScale={0.1}
        maxScale={8}
        // No centring of the library's own: the fit frames the first page.
        limitToBounds={false}
        wheel={VIEWPORT_WHEEL_ZOOM}
        panning={{
          velocityDisabled: true,
          wheelPanning: true,
          allowMiddleClickPan: true,
          // A finger drags the pages; a mouse drags them with Space held.
          allowLeftClickPan: spacePressed || coarse,
        }}
        pinch={VIEWPORT_PINCH_ZOOM}
        doubleClick={{ disabled: true }}
        onInit={onInit}
        onTransformed={onTransformed}
      >
        <TransformComponent
          wrapperStyle={{ width: '100%', height: '100%' }}
          contentStyle={{ width: worldRect.width, height: worldRect.height }}
        >
          <div className={styles.world} style={{ width: worldRect.width, height: worldRect.height }}>
            {pages?.layout.pages.map((page, index) => {
              const top = PAD + index * pitch;
              const margin = pages.layout.paper.marginMm;
              return (
                <div key={index}>
                  <div
                    ref={(element) => {
                      if (element) pageRefs.current.set(index, element);
                      else pageRefs.current.delete(index);
                    }}
                    data-page={index}
                    className={styles.page}
                    style={{ left: PAD, top, width: pageW, height: pageH }}
                    onClick={onPageClick}
                  >
                    {isNear(index) && (
                      <img
                        className={styles.image}
                        src={composedPageUrl(pages, index)}
                        alt={t('panels:diagram.pages.pageAlt', 'Page {{number}}', { number: page.number })}
                        draggable={false}
                      />
                    )}
                    {margin > 0 && (
                      <div
                        className={styles.guide}
                        style={{ left: mm(margin), top: mm(margin), right: mm(margin), bottom: mm(margin) }}
                      />
                    )}
                    {page.cells.map((cell) => {
                      const step = stepsById.get(cell.stepId);
                      const empty = step ? !stepHasPicture(step) : false;
                      return (
                        <div key={cell.stepId}>
                          {empty && (
                            <div
                              className={styles.placeholder}
                              style={{
                                left: mm(cell.pictureMm.x),
                                top: mm(cell.pictureMm.y),
                                width: mm(cell.pictureMm.size),
                                height: mm(cell.pictureMm.size),
                              }}
                            >
                              {t('panels:diagram.pages.noPicture', 'No picture yet')}
                            </div>
                          )}
                          {cell.textOverflow && (
                            <div
                              className={styles.overflow}
                              style={{ left: mm(cell.text.x), top: mm(cell.text.firstBaseline) + 4 }}
                            >
                              {t('panels:diagram.pages.textCut', 'Text doesn’t fit')}
                            </div>
                          )}
                          <div
                            role="button"
                            tabIndex={-1}
                            aria-label={t('panels:diagram.pages.step', 'Step {{number}}', { number: cell.number })}
                            aria-selected={cell.stepId === selectedStepId}
                            data-step-id={cell.stepId}
                            className={styles.cell}
                            style={{
                              left: mm(cell.cellMm.x),
                              top: mm(cell.cellMm.y),
                              width: mm(cell.cellMm.w),
                              height: mm(cell.cellMm.h),
                            }}
                            onClick={(event) => onCellClick(event, cell.stepId)}
                            onDoubleClick={(event) => {
                              event.stopPropagation();
                              onOpen(cell.stepId);
                            }}
                          />
                        </div>
                      );
                    })}
                  </div>
                  <div className={styles.caption} style={{ left: PAD, top: top + pageH + 6, width: pageW }}>
                    {t('panels:diagram.pages.caption', 'Page {{number}}', { number: page.number })}
                  </div>
                </div>
              );
            })}
          </div>
        </TransformComponent>
      </TransformWrapper>
      {!pages && (
        <div className={styles.status} role="status">
          {failed
            ? t('panels:diagram.pages.failed', 'The pages couldn’t be laid out. Check your connection and try again.')
            : t('panels:diagram.pages.loading', 'Laying out the pages…')}
        </div>
      )}
      <ViewportToolbar
        ariaLabel={t('panels:diagram.pages.controls', 'Page view controls')}
        zoomPercent={zoomPercent}
        zoomIn={zoomIn}
        zoomOut={zoomOut}
        fitToView={fitToView}
        setZoomLevel={setZoomLevel}
        groups={[
          {
            id: 'page-of',
            items: [
              {
                kind: 'node',
                id: 'page-of',
                node: (
                  <span className={styles.pageOf} aria-live="polite">
                    {t('panels:diagram.pages.pageOf', 'Page {{number}} of {{total}}', {
                      number: pages?.layout.pages[current]?.number ?? 1,
                      total: count,
                    })}
                  </span>
                ),
              },
            ],
          },
        ]}
      />
    </div>
  );
}
