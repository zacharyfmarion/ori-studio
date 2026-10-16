import { partBox } from '../../diagram/pages/pagePlacement';
import { usePagePlacement } from '../../diagram/pages/usePagePlacement';
import { DiagramPagesPlacement, PAGE_PLACEMENT_PAN_EXCLUDED } from './DiagramPagesPlacement';
import type { MouseEvent } from 'react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { TransformComponent, TransformWrapper } from 'react-zoom-pan-pinch';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { VIEWPORT_PINCH_ZOOM, VIEWPORT_WHEEL_ZOOM } from '../../hooks/useViewportSurface';
import { useIsCoarsePointerSurface } from '../../platform/pointerSurface';
import { DIAGRAM_STEPS_ATTRIBUTE } from '../../diagram/actions/diagramShortcuts';
import { isLockedStep, stepHasPicture, type DiagramStep } from '../../diagram/document/diagramDocument';
import {
  STEP_TEXT_LEADING_MM,
  STEP_TEXT_SIZE_MM,
  TURN_STACK_CLEAR_MM,
  type LayoutPage,
} from '../../diagram/pages/diagramPageLayout';
import type { PreparedDiagramPages } from '../../diagram/pages/diagramPages';
import { composedPageUrl } from '../../diagram/pages/useDiagramPages';
import { PAGES_PAD, PAGES_PX_PER_MM, usePagesView } from '../../diagram/pages/usePagesView';
import { ViewportToolbar } from '../panels/ViewportToolbar';
import { DiagramPageBand } from './DiagramPageBand';
import { DiagramPagePreview } from './DiagramPagePreview';
import { DiagramTitleBlockOverlay } from './DiagramTitleBlockOverlay';
import { PageGuide } from './PageGuide';
import { PagePlaceholder } from './PagePlaceholder';
import styles from './DiagramPagesView.module.css';
import { turnLabel, type TurnBetween } from '../../diagram/actions/diagramTurnActions';

/** How far a cut instruction's outline stands off its text, in mm. */
const CUT_OUTLINE_MM = 1;

/**
 * The target over a turn's glyph on a page reaches this far past the glyph, mm:
 * half the clear space between two stacked turns, so neighbours never overlap.
 * An enlarge arrow's too, which stands in the same stacks.
 */
const TURN_TARGET_PAD_MM = TURN_STACK_CLEAR_MM / 2;

/**
 * Page `index`'s image: composed without its band, and while a part of a step
 * is lifted off it — a drag, or a nudge in its pause — without that part,
 * from the layout the lift began on; the part is drawn over it on its own
 * (`DiagramPagesPlacement`). A resize lifts the whole step.
 */
function pageImageUrl(
  pages: PreparedDiagramPages,
  index: number,
  draft: ReturnType<typeof usePagePlacement>['draft']
): string {
  if (draft?.page !== index) return composedPageUrl(pages, index, { band: false });
  const part = draft.pointer?.size ? 'frame' : draft.part;
  return composedPageUrl(draft.base, index, { band: false, omit: { stepId: draft.cell.stepId, part } });
}

/**
 * The Pages view (D10): each page as it will print, composed into an SVG and
 * shown as a cached bitmap of that SVG, so what the screen shows is the file — all but the
 * flow band, which the view draws under the image from the file's own path
 * and pen (`DiagramPageBand`), so that a colour being picked repaints the
 * band alone and a new colour composes no page again.
 *
 * Over each page, and never in it: the margin guide, the first page's title
 * block with a box where a part of its art prints nothing
 * (`DiagramTitleBlockOverlay`), a box for a step with no picture yet, a mark
 * where an instruction was cut, and each step as an option
 * of one listbox — the Steps grid's keyboard, so Enter opens the step, Delete
 * deletes it and the selected one is the tab stop. A press on a step focuses
 * it and selects it with its frame; a press on a selected frame selects the
 * part under it; the arrows nudge what is selected, and a drag moves it
 * (Decision 7, `usePagePlacement`, drawn by `DiagramPagesPlacement`). With no
 * part selected the arrows move the selection. A press elsewhere on a page is
 * a question about the page, which brings the Page tab forward; it lets the
 * selection go, step and part, as a press on the space round the pages does,
 * so the next press on a step selects its whole frame again. Any press on a
 * page makes it the panes' "this page" (`pageInView.ts`); a press that ends a
 * pan is none of these; a double press opens nothing. An enlarge arrow
 * (Revision 2) is a target for the pointer only, over where the page prints
 * it: a press selects the enlarged step it leads to, which the keyboard
 * reaches as a step. The camera and the rest of the behaviour are
 * `usePagesView`'s.
 */
export function DiagramPagesView({
  pages: prepared,
  failed,
  steps,
  selectedStepId,
  pathColor,
  fitKey,
  onSelect,
  onPageClick,
}: {
  pages: PreparedDiagramPages | null;
  failed: boolean;
  steps: readonly DiagramStep[];
  selectedStepId: string | null;
  /** The flow band's colour as the diagram has it now, which a layout under way may not yet. */
  pathColor: string;
  /** What counts as a new set of pages to frame: a new diagram, or new paper. */
  fitKey: string;
  /** Select a step, a turn or an arrow's step; null lets the selection go. */
  onSelect: (stepId: string | null) => void;
  onPageClick: () => void;
}) {
  const { t } = useTranslation();
  const coarse = useIsCoarsePointerSurface();
  const {
    containerRef,
    transformRef,
    zoomPercent,
    spacePressed,
    zoomIn,
    zoomOut,
    fitToView,
    setZoomLevel,
    onInit,
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
  } = usePagesView({ pages: prepared, selectedStepId, fitKey });
  const placement = usePagePlacement(prepared, spacePressed, failed);
  const pages = placement.pages;
  const stepsById = useMemo(() => new Map(steps.map((step) => [step.id, step])), [steps]);
  const mm = (value: number) => value * PAGES_PX_PER_MM;
  const tabStop = selectedStepId ?? pages?.layout.pages[0]?.cells[0]?.stepId ?? null;

  // A press on a step, a turn or an arrow on page `index` selects it, and makes that page "this page" for the panes.
  const onCellClick = (event: MouseEvent, stepId: string, index: number) => {
    event.stopPropagation();
    if (pressWasPan()) return;
    onSelect(stepId);
    pressPage(index, stepId);
  };

  // A turn between steps (D22): its glyph's box, selected as a cell is; it opens nothing.
  const turnTarget = (turn: LayoutPage['turns'][number], between: TurnBetween, index: number) => (
    <div
      key={turn.id}
      ref={cellRef(turn.id)}
      role="option"
      tabIndex={turn.id === tabStop ? 0 : -1}
      aria-label={turnLabel(turn.turn, between, t)}
      aria-selected={turn.id === selectedStepId}
      data-step-id={turn.id}
      className={styles.turn}
      style={{
        left: mm(turn.at.x - turn.box.w / 2 - TURN_TARGET_PAD_MM),
        top: mm(turn.at.y - turn.box.h / 2 - TURN_TARGET_PAD_MM),
        width: mm(turn.box.w + 2 * TURN_TARGET_PAD_MM),
        height: mm(turn.box.h + 2 * TURN_TARGET_PAD_MM),
      }}
      onClick={(event) => onCellClick(event, turn.id, index)}
      onDoubleClick={(event) => event.stopPropagation()}
    />
  );

  return (
    <div ref={containerRef} className={styles.view} data-space-pan={spacePressed || undefined} tabIndex={-1}>
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
          excluded: spacePressed ? [] : [...PAGE_PLACEMENT_PAN_EXCLUDED, styles.selectedCell],
        }}
        pinch={VIEWPORT_PINCH_ZOOM}
        doubleClick={{ disabled: true }}
        onInit={onInit}
        onTransformed={onTransformed}
        onPanningStart={onPanningStart}
        onPanningStop={onPanningStop}
      >
        <TransformComponent
          wrapperStyle={{ width: '100%', height: '100%' }}
          contentStyle={{ width: worldRect.width, height: worldRect.height }}
          // A press on the space round the pages, past every step and page, lets the selection go.
          wrapperProps={{
            onClick: () => {
              if (!pressWasPan()) onSelect(null);
            },
          }}
        >
          <div
            role="listbox"
            aria-label={t('panels:diagram.pages.label', 'Steps on the pages')}
            className={styles.world}
            style={{ width: worldRect.width, height: worldRect.height }}
            {...{ [DIAGRAM_STEPS_ATTRIBUTE]: '' }}
          >
            {pages?.layout.pages.map((page, index) => {
              const top = PAGES_PAD + index * pitch;
              const margin = pages.layout.paper.marginMm;
              // Named by the number it prints, or by its place when it prints none.
              const name = page.pageNumberAt ? page.number : index + 1;
              const label = t('panels:diagram.pages.caption', 'Page {{number}}', { number: name });
              // Keep lightweight page shells for the camera and observer. Only
              // nearby pages need targets and artwork. Keep the selected page's
              // targets too, so keyboard reveal and an ongoing drag retain their DOM.
              const interactive = isNear(index) || page.cells.some((cell) => cell.stepId === selectedStepId)
                || page.turns.some((turn) => turn.id === selectedStepId);
              return (
                <div key={index}>
                  <div
                    ref={pageRef(index)}
                    role="group"
                    aria-label={label}
                    data-page={index}
                    className={styles.page}
                    style={{ left: PAGES_PAD, top, width: pageW, height: pageH }}
                    onClick={(event) => {
                      // The page's, not the space round it.
                      event.stopPropagation();
                      if (pressWasPan()) return;
                      onSelect(null);
                      pressPage(index, null);
                      onPageClick();
                    }}
                  >
                    {interactive && <>
                    {isNear(index) && page.band && page.band.curves.length > 0 && (
                      <DiagramPageBand
                        className={styles.band}
                        lane={page.band}
                        widthMm={pages.layout.bandWidthMm}
                        paper={pages.layout.paper}
                        color={pathColor}
                      />
                    )}
                    {isNear(index) && (
                      <DiagramPagePreview
                        className={styles.image}
                        src={pageImageUrl(prepared ?? pages, index, placement.draft)}
                        width={pageW}
                        height={pageH}
                        scale={zoomPercent / 100}
                        vectorWhileLoading={false}
                      />
                    )}
                    {margin > 0 && (
                      <PageGuide style={{ left: mm(margin), top: mm(margin), right: mm(margin), bottom: mm(margin) }} />
                    )}
                    {page.titleBlock && pages.titleBlock && (
                      <DiagramTitleBlockOverlay
                        block={page.titleBlock}
                        content={pages.titleBlock}
                        model={pages.titleBlockModel()}
                        paper={pages.layout.paper}
                      />
                    )}
                    {page.cells.map((cell) => {
                      const step = stepsById.get(cell.stepId);
                      const empty = step ? !stepHasPicture(step) : false;
                      const frame = partBox(cell, 'frame');
                      return (
                        <div key={cell.stepId}>
                          {/* The turns before this step (D22), before it in reading order as on the page. */}
                          {page.turns
                            .filter((turn) => turn.beforeStepId === cell.stepId)
                            .map((turn) =>
                              turnTarget(
                                turn,
                                { before: cell.number > 1 ? cell.number - 1 : null, after: cell.number },
                                index
                              )
                            )}
                          {empty && (
                            <PagePlaceholder
                              kind="picture"
                              style={{
                                left: mm(cell.pictureMm.x),
                                top: mm(cell.pictureMm.y),
                                width: mm(cell.pictureMm.size),
                                height: mm(cell.pictureMm.size),
                              }}
                            >
                              {/* A newer build's step this build cannot draw says why, as its card does. */}
                              {step && isLockedStep(step)
                                ? t('panels:diagram.card.locked', 'Made with a newer Ori Studio')
                                : t('panels:diagram.pages.noPicture', 'No picture yet')}
                            </PagePlaceholder>
                          )}
                          {cell.textOverflow && (
                            // Round the text, never over it: an outline of the
                            // lines it set, and the word on a tab under its end.
                            <div
                              className={styles.overflow}
                              aria-hidden="true"
                              style={{
                                left: mm(cell.text.x - CUT_OUTLINE_MM),
                                top: mm(cell.text.firstBaseline - STEP_TEXT_SIZE_MM - CUT_OUTLINE_MM),
                                width: mm(cell.text.widthMm + 2 * CUT_OUTLINE_MM),
                                height: mm(
                                  STEP_TEXT_SIZE_MM +
                                    (Math.max(1, cell.text.lines.length) - 1) * STEP_TEXT_LEADING_MM +
                                    2 * CUT_OUTLINE_MM
                                ),
                              }}
                            >
                              <span className={styles.overflowTab}>
                                {t('panels:diagram.pages.textCut', 'Text doesn’t fit')}
                              </span>
                            </div>
                          )}
                          <div
                            ref={cellRef(cell.stepId)}
                            role="option"
                            tabIndex={cell.stepId === tabStop ? 0 : -1}
                            aria-label={
                              cell.textOverflow
                                ? t('panels:diagram.pages.stepCut', 'Step {{number}}, text doesn’t fit', {
                                    number: cell.number,
                                  })
                                : t('panels:diagram.pages.step', 'Step {{number}}', { number: cell.number })
                            }
                            aria-selected={cell.stepId === selectedStepId}
                            data-step-id={cell.stepId}
                            className={`${styles.cell} ${cell.stepId === selectedStepId ? styles.selectedCell : ''}`}
                            style={{ left: mm(frame.x), top: mm(frame.y), width: mm(frame.w), height: mm(frame.h) }}
                            onPointerDown={(event) => placement.start(event, index, cell)}
                            onPointerMove={placement.move}
                            onPointerUp={placement.end}
                            onPointerCancel={placement.cancel}
                            onLostPointerCapture={placement.lost}
                            onClick={(event) => onCellClick(event, cell.stepId, index)}
                            onDoubleClick={(event) => {
                              event.stopPropagation();
                            }}
                          />
                        </div>
                      );
                    })}
                    {page.turns
                      .filter((turn) => turn.beforeStepId === null)
                      .map((turn) => turnTarget(turn, { before: page.cells.at(-1)?.number ?? null, after: null }, index))}
                    {/* The enlarge arrows where the page prints them, lifted to their areas. */}
                    {isNear(index) &&
                      pages.zoomArrows(index).map((arrow) => (
                        <div
                          key={`arrow-${arrow.beforeStepId}`}
                          aria-hidden="true"
                          data-zoom-arrow={arrow.beforeStepId}
                          className={styles.arrow}
                          style={{
                            left: mm(arrow.at.x - arrow.box.w / 2 - TURN_TARGET_PAD_MM),
                            top: mm(arrow.at.y - arrow.box.h / 2 - TURN_TARGET_PAD_MM),
                            width: mm(arrow.box.w + 2 * TURN_TARGET_PAD_MM),
                            height: mm(arrow.box.h + 2 * TURN_TARGET_PAD_MM),
                          }}
                          onClick={(event) => onCellClick(event, arrow.beforeStepId, index)}
                          onDoubleClick={(event) => {
                            event.stopPropagation();
                          }}
                        />
                      ))}
                    {isNear(index) && <DiagramPagesPlacement page={page} index={index} placement={placement} />}
                    </>}
                  </div>
                  <div
                    className={styles.caption}
                    aria-hidden="true"
                    style={{ left: PAGES_PAD, top: top + pageH + 6, width: pageW }}
                  >
                    {label}
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
        // On a phone the bar is a pager: a pinch zooms, and Fit is in its menu.
        phoneViewControls="collapsed"
        groups={
          pages
            ? [
                {
                  id: 'page-of',
                  items: [
                    {
                      kind: 'action',
                      id: 'previous-page',
                      label: t('panels:diagram.pages.previousPage', 'Previous Page'),
                      icon: <ChevronLeft size={15} />,
                      disabled: current <= 0,
                      pinned: true,
                      onSelect: () => goToPage(current - 1),
                    },
                    {
                      kind: 'node',
                      id: 'page-of',
                      node: (
                        <span className={styles.pageOf}>
                          {t('panels:diagram.pages.pageOf', 'Page {{number}} of {{total}}', {
                            number: Math.min(current + 1, count),
                            total: count,
                          })}
                        </span>
                      ),
                    },
                    {
                      kind: 'action',
                      id: 'next-page',
                      label: t('panels:diagram.pages.nextPage', 'Next Page'),
                      icon: <ChevronRight size={15} />,
                      disabled: current >= count - 1,
                      pinned: true,
                      onSelect: () => goToPage(current + 1),
                    },
                  ],
                },
              ]
            : []
        }
      />
    </div>
  );
}
