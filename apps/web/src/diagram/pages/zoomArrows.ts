/**
 * Enlarge arrows where a page prints them (Revision 2, Z3): the layout's
 * places (`placeTurns`), and one more step only the page can take, since
 * only it knows where each picture lands in its room — an arrow standing
 * alone in the gutter of a row it shares with the area's step is lifted to
 * the area's printed height, its box kept inside both pictures' vertical
 * overlap and below both steps' numbers. Beside a turn, or across a row or a
 * page, it stays where the layout put it.
 *
 * The composer lifts them from the pictures it draws; the Pages view, for
 * their hit targets, through {@link liftedZoomArrows}, from the same two.
 *
 * Pure: no DOM, no store.
 */
import { PT_PER_MM } from '../../lib/paper/paperSvg';
import {
  isKnownAnnotation,
  type DiagramAsset,
  type DiagramStep,
  type DiagramStyle,
} from '../document/diagramDocument';
import { PICTURE_TOP_MM, type DiagramPagesLayout, type LayoutPage, type LayoutZoomArrow } from './diagramPageLayout';
import { partBox } from './pagePlacement';
import { cellPicture, type CellPicture, type PictureText } from './pagePictures';

/** An enlarge arrow as its page prints it: the layout's, lifted to its area where it stands alone beside it. */
export type PlacedZoomArrow = LayoutZoomArrow;

/**
 * The page's arrows, each lifted where it may be: `pictureOf` gives the
 * picture a page cell (by its index on the page) draws, as the page places it.
 */
export function placedZoomArrows(
  page: LayoutPage,
  steps: ReadonlyMap<string, DiagramStep>,
  pictureOf: (cellIndex: number) => CellPicture | null
): PlacedZoomArrow[] {
  return page.zoomArrows.map((arrow) => {
    if (!arrow.liftable) return arrow;
    const areaIndex = page.cells.findIndex((cell) => cell.stepId === arrow.areaStepId);
    const nextIndex = page.cells.findIndex((cell) => cell.stepId === arrow.beforeStepId);
    const area = steps
      .get(arrow.areaStepId)
      ?.annotations.find((annotation) => annotation.id === arrow.areaId && isKnownAnnotation(annotation));
    if (areaIndex < 0 || nextIndex < 0 || !area || !isKnownAnnotation(area)) return arrow;
    const [areaPicture, nextPicture] = [pictureOf(areaIndex), pictureOf(nextIndex)];
    if (!areaPicture || !nextPicture) return arrow;
    const { framePt } = areaPicture;
    // The area's centre as it prints: on its step's frame, as every mark is.
    const centre = (framePt.y + area.from[1] * Math.max(framePt.width, framePt.height)) / PT_PER_MM;
    const mm = (picture: CellPicture) => ({
      top: picture.boundsPt.y / PT_PER_MM,
      bottom: (picture.boundsPt.y + picture.boundsPt.height) / PT_PER_MM,
    });
    const [a, b] = [mm(areaPicture), mm(nextPicture)];
    // Both pictures' overlap, below both numbers: the one at the gutter's side is either step's, by which way the row reads.
    const numbers = Math.max(...[page.cells[areaIndex]!, page.cells[nextIndex]!].map((cell) => cell.flowRow !== undefined || cell.placed ? partBox(cell, 'number').y + partBox(cell, 'number').h : cell.cellMm.y + PICTURE_TOP_MM));
    const top = Math.max(a.top, b.top, numbers);
    const bottom = Math.min(a.bottom, b.bottom);
    const half = arrow.box.h / 2;
    if (bottom < top + arrow.box.h && (page.cells[areaIndex]!.placed || page.cells[nextIndex]!.placed || page.cells[areaIndex]!.flowRow !== undefined)) return arrow;
    // Clear of the numbers first, where the overlap is too short to hold it.
    const y = Math.max(top + half, Math.min(centre, bottom - half));
    if (!Number.isFinite(y)) return arrow;
    const proposed = { ...arrow, at: { x: arrow.at.x, y } };
    if (page.cells.some(c => c.placed || c.flowRow !== undefined)) {
      const g = { x: arrow.at.x - arrow.box.w / 2, y: y - half, ...arrow.box };
      const overlap = page.cells.some(cell => (['number', 'picture', 'text'] as const).some(part => {
        const b = partBox(cell, part);
        return b.w > 0 && b.h > 0 && g.x < b.x + b.w && g.x + g.w > b.x && g.y < b.y + b.h && g.y + g.h > b.y;
      }));
      if (overlap) return arrow;
    }
    return proposed;
  });
}

/**
 * The page's arrows as {@link placedZoomArrows} lifts them, each lifted one's
 * two pictures drawn as the page draws them: for a surface that shows where
 * the arrows print without composing the page.
 */
export function liftedZoomArrows(
  page: LayoutPage,
  steps: ReadonlyMap<string, DiagramStep>,
  assets: Readonly<Record<string, DiagramAsset>>,
  style: DiagramStyle,
  text: PictureText
): PlacedZoomArrow[] {
  if (!page.zoomArrows.some((arrow) => arrow.liftable)) return page.zoomArrows;
  const pictures = new Map<number, CellPicture | null>();
  return placedZoomArrows(page, steps, (index) => {
    if (!pictures.has(index)) {
      const cell = page.cells[index]!;
      const step = steps.get(cell.stepId);
      pictures.set(index, step ? cellPicture(step, assets, style, cell, `c${index}-`, text) : null);
    }
    return pictures.get(index)!;
  });
}

/** An enlarged step on the page after the area it enlarges: its number, and the number of the step the area is on. */
export interface ZoomSplit {
  step: number;
  area: number;
}

/**
 * The enlarged steps whose arrow prints on another page than their area
 * (Z3, "No keep-together rule"), where Start a New Page Here on the area's
 * step would bring the two together: the arrow then stands at the enlarged
 * step's leading edge, and the Pages view and the export say so. `steps`
 * are the steps laid out, for which start a new page by their own Start a
 * New Page Here. Left out: an enlarged step that starts its page so — the
 * break asked for — and one whose area's step starts its page already, where
 * no break brings them together.
 */
export function zoomSplits(layout: DiagramPagesLayout, steps: readonly { id: string; breakBefore: boolean }[]): ZoomSplit[] {
  const breaks = new Set(steps.filter((step) => step.breakBefore).map((step) => step.id));
  const numbers = new Map(layout.pages.flatMap((page) => page.cells.map((cell) => [cell.stepId, cell.number] as const)));
  /** The step each page starts with. */
  const firsts = new Set(layout.pages.map((page) => page.cells[0]?.stepId));
  return layout.pages.flatMap((page) =>
    page.zoomArrows.flatMap((arrow) => {
      if (page.cells.some((cell) => cell.stepId === arrow.areaStepId)) return [];
      if (breaks.has(arrow.beforeStepId) || firsts.has(arrow.areaStepId)) return [];
      const [step, area] = [numbers.get(arrow.beforeStepId), numbers.get(arrow.areaStepId)];
      return step !== undefined && area !== undefined ? [{ step, area }] : [];
    })
  );
}
