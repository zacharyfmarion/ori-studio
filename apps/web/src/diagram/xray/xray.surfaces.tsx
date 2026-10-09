import { renderToStaticMarkup } from 'react-dom/server';
import { DiagramXRayInsides } from '../../components/diagram/DiagramXRayInsides';
import { PT_TO_CSS_PX } from '../../lib/paper/paperStyle';
import { annotationDrawing } from '../annotate/annotationPrimitives';
import { CARD_FRAME_PX } from '../annotate/canvasInk';
import { DEFAULT_DIAGRAM_STYLE, type DiagramStep } from '../document/diagramDocument';
import { estimateTextSetter } from '../pages/estimateTextSetter';
import { cellPicture } from '../pages/pagePictures';
import { paintSource, stepPictureSource, type PictureBox } from '../pictures/paintDiagramStep';
import { annotatedStepUrl, posedZoomUrl, zoomedStepUrl } from '../pictures/useStepPictureUrl';
import { paintZoomedPicture, zoomedSource } from '../zoom/paintZoomed';
import { markGeometry, viewFrame, viewOfStep } from '../zoom/stepView';
import { xrayInsides } from './useXRayInsides';
import { xraySurfaceOf } from './xrayPaint';

const style = DEFAULT_DIAGRAM_STYLE;

/** A page cell 60 mm square, its picture fitted to it: what a page, print, the PDF, the sheet and a step file draw through. */
export const XRAY_CELL = { pictureMm: { x: 10, y: 20, size: 60 }, mmPerUnit: null, frameMm: null };

/** One surface's x-rays: where its drawing's frame lands, in its units, its units per pt, and each window it paints. */
export interface XRaySurfaceDrawn {
  frame: PictureBox;
  unitsPerPt: number;
  /** Each window's markup (`xrayWindowMarkup`), in the surface's units: its inside and rim, or in Pose its rim. */
  windows: string[];
  /** Everything the surface draws, its windows among it. */
  markup: string;
}

/** What is inside each group of `markup` that opens with the tag `open`, its own groups included. */
export function groupsIn(markup: string, open: string): string[] {
  const groups: string[] = [];
  for (let at = markup.indexOf(open); at >= 0; at = markup.indexOf(open, at + 1)) {
    const tags = /<g[\s>]|<\/g>/g;
    tags.lastIndex = at + open.length;
    let depth = 1;
    let end = markup.length;
    for (let tag = tags.exec(markup); tag; tag = tags.exec(markup)) {
      depth += tag[0] === '</g>' ? -1 : 1;
      if (depth === 0) {
        end = tag.index;
        break;
      }
    }
    groups.push(markup.slice(at + open.length, end));
  }
  return groups;
}

/** The windows a surface's markup holds: what is inside each `data-x-ray-window` group. */
export function xrayWindowsIn(markup: string): string[] {
  return groupsIn(markup, '<g data-x-ray-window="">');
}

/** An SVG data URL's document. */
function fromDataUrl(url: string | null): string {
  if (!url) throw new Error('no picture');
  const base64 = url.slice(url.indexOf(',') + 1);
  return new TextDecoder().decode(Uint8Array.from(atob(base64), (char) => char.charCodeAt(0)));
}

/**
 * A step's x-rays as each surface paints them (Revision 3, 18f), from the
 * functions those surfaces call, as they call them:
 *
 * - `canvas`: the Annotate canvas's insides (`xrayInsides`), the drawing's
 *   frame at the origin, `CARD_FRAME_PX` across;
 * - `card`: a step card's picture (`annotatedStepUrl`, or an enlarged step's
 *   `zoomedStepUrl`), as `useStepPictureUrl` asks for it;
 * - `page`: a page cell ({@link XRAY_CELL}, `cellPicture`), what the Pages
 *   view, print, the PDF, the one-sheet SVG and a ZIP's step files draw —
 *   its frame and reach in its markup's own units, before the shift that
 *   settles it in its room;
 * - `pose`: Pose's ghost of the card (`annotatedStepUrl` at 0.3, or an
 *   enlarged step's `posedZoomUrl`), each window its rim alone (R3-19 A).
 *
 * Each with the frame its marks land on, in its units, and its units per pt.
 */
export function xraySurfaces(step: DiagramStep) {
  const source = stepPictureSource(step, {})!;
  const zoomed = zoomedSource(step, {});
  const layers = markGeometry(step, {}, style).layers;
  const { annotations } = step;
  const frame = viewFrame(viewOfStep(step), {})!;

  // The canvas: its drawing compiled on the view's frame, its windows drawn at the origin.
  const drawing = annotationDrawing(annotations, frame, CARD_FRAME_PX, style, layers);
  const insides = xrayInsides({ step, drawing, shown: annotations, zoom: viewOfStep(step).zoom, style, framePx: CARD_FRAME_PX, idPrefix: 'x' });
  const canvas: XRaySurfaceDrawn = {
    frame: { x: 0, y: 0, width: drawing.width, height: drawing.height },
    unitsPerPt: PT_TO_CSS_PX,
    windows: insides.map((inside) => inside.markup),
    markup: renderToStaticMarkup(<DiagramXRayInsides insides={insides} />),
  };

  // A card, as the hook paints it, at one: its frame where the picture is painted.
  const xRays = xraySurfaceOf(step);
  const cardMarkup = fromDataUrl(
    zoomed ? zoomedStepUrl(zoomed, annotations, style, false, layers, xRays) : annotatedStepUrl(source, annotations, style, 1, false, layers, xRays)
  );
  const cardFrame = (zoomed ? paintZoomedPicture(zoomed, style) : paintSource(source, style))!.frame;
  const card: XRaySurfaceDrawn = {
    frame: cardFrame,
    unitsPerPt: (Math.max(cardFrame.width, cardFrame.height) / CARD_FRAME_PX) * PT_TO_CSS_PX,
    windows: xrayWindowsIn(cardMarkup),
    markup: cardMarkup,
  };

  // A page's cell, in pt: its frame and what it reaches in its markup's own units, before the shift that settles it
  // in its room (a `translate` round the whole).
  const cell = cellPicture(step, {}, style, XRAY_CELL, 'c0-', { hanStyle: 'sc', runs: estimateTextSetter.runs })!;
  const settled = /^<g transform="translate\(([-\d.]+) ([-\d.]+)\)">/.exec(cell.markup);
  const [dx, dy] = settled ? [Number(settled[1]), Number(settled[2])] : [0, 0];
  const page: XRaySurfaceDrawn & { boundsPt: PictureBox } = {
    frame: { ...cell.framePt, x: cell.framePt.x - dx, y: cell.framePt.y - dy },
    unitsPerPt: 1,
    windows: xrayWindowsIn(cell.markup),
    markup: cell.markup,
    boundsPt: { ...cell.boundsPt, x: cell.boundsPt.x - dx, y: cell.boundsPt.y - dy },
  };

  // Pose's ghost of the card: the rims alone, on the whole picture — an enlarged step's too, its marks on its window
  // there (`posedZoomPicture`).
  const rims = xraySurfaceOf(step, 'rim');
  const poseMarkup = fromDataUrl(
    zoomed ? posedZoomUrl(zoomed, annotations, style, 0.3, false, rims) : annotatedStepUrl(source, annotations, style, 0.3, false, null, rims)
  );
  const pose = {
    frame: paintSource(zoomed ? zoomed.source : source, style)!.frame,
    windows: xrayWindowsIn(poseMarkup),
    markup: poseMarkup,
  };
  return { canvas, card, page, pose };
}
