/**
 * A diagram's pages, ready to compose (D10): its fonts loaded, its steps laid
 * out with the fonts' own advances, and each page composed on demand — the
 * Pages view composes the pages in view, an export every page.
 *
 * Laid out once per call: a change to the diagram is a new call. The fonts and
 * the subsetter are kept by their modules, so a new call costs the layout and
 * the pages it composes, not a download.
 */
import {
  isLockedTurn,
  isTurn,
  stepAsset,
  stepsOf,
  type DiagramDocument,
  type DiagramStep,
  type DiagramZoomOutline,
} from '../document/diagramDocument';
import type { DiagramFontFace } from '../fonts/diagramFontFaces';
import { loadDiagramFonts, type DiagramFontSource, type DiagramFontText, type DiagramFonts } from '../fonts/diagramFonts';
import { embeddedFontFaces } from '../fonts/fontEmbedding';
import type { FontSubsetter } from '../fonts/fontSubset';
import { composeDiagramPage, type ComposedPage } from './composeDiagramPage';
import {
  layoutDiagramPages,
  pictureFit,
  pictureFloor,
  pictureOverrun,
  type DiagramPagesLayout,
  type LayoutStep,
  type LayoutTurn,
  type LayoutZoom,
  type TextSetter,
} from './diagramPageLayout';
import { fontTextSetter } from './fontTextSetter';
import { uploadTextRuns, type UploadTextRun } from '../upload/uploadText';
import { layoutPicture, wholeUnitsAcross, type PictureMeasure } from './pagePictures';
import { annotationTextRuns } from '../annotate/annotationPrimitives';
import { hasDrawnAnnotations } from '../annotate/paintAnnotations';
import { viewOfStep } from '../zoom/stepView';
import { zoomAreas } from '../zoom/zoomCapture';
import { enlargeArrowSizes } from '../zoom/enlargeArrow';
import { zoomIndex, type ZoomIndex } from '../zoom/zoomIndex';
import { zoomOutlineOf, zoomShapeOf } from '../zoom/zoomModel';
import { liftedZoomArrows, type PlacedZoomArrow } from './zoomArrows';

export interface DiagramPagesDependencies {
  fontSource: DiagramFontSource;
  subsetter: () => Promise<FontSubsetter>;
}

export interface PreparedDiagramPages {
  layout: DiagramPagesLayout;
  /** The setter the layout set its text with: a page's numbers are set with it too. */
  setter: TextSetter;
  /** Characters no font has: drawn by the reader's own fonts on screen. */
  missing: string[];
  /** CJK faces the text needs that could not be loaded. */
  unavailableFonts: DiagramFontFace[];
  /** Page `index` (from 0) as an SVG document; `band: false` leaves the flow band out, for the Pages view. */
  compose: (index: number, options?: { band?: boolean }) => ComposedPage;
  /**
   * The enlarge arrows on page `index` where it prints them (Revision 2),
   * lifted to their areas as the page lifts them: what the Pages view puts
   * their hit targets over. Worked out once a page.
   */
  zoomArrows: (index: number) => PlacedZoomArrow[];
}

/** A step's picture as the layout measures it at `measure` (`layoutPicture`). */
export type PictureOf = (step: DiagramStep, measure: PictureMeasure) => LayoutStep['picture'];

/**
 * What the layout needs of each step, its marks measured at the size a first
 * layout found for it when known (`measureOf`), by `pictureOf`; each with
 * the turns between it and the step before (D22), the last with any after
 * it.
 */
export function diagramLayoutSteps(
  document: DiagramDocument,
  measureOf: (stepId: string) => PictureMeasure = () => null,
  pictureOf: PictureOf = (step, measure) => layoutPicture(step, document.assets, document.style, measure)
): LayoutStep[] {
  const steps: LayoutStep[] = [];
  const index = zoomIndex(document);
  let turns: LayoutTurn[] = [];
  for (const entry of document.steps) {
    if (isTurn(entry)) {
      // A newer build's turn is this build's to carry, not to draw.
      if (isLockedTurn(entry)) continue;
      const { id, unknown: _unknown, ...turn } = entry;
      turns.push({ id, turn });
      continue;
    }
    const zoom = layoutZoom(entry, document, index);
    steps.push({
      id: entry.id,
      text: entry.text,
      breakBefore: entry.breakBefore,
      picture: pictureOf(entry, measureOf(entry.id)),
      turnsBefore: turns,
      turnsAfter: [],
      // Enlarged, with no window yet: in no run of enlarged steps, and parting none.
      ...(zoom ? { zoom } : entry.zoom ? { zoomPending: true as const } : {}),
    });
    turns = [];
  }
  const last = steps.at(-1);
  if (last && turns.length > 0) steps[steps.length - 1] = { ...last, turnsAfter: turns };
  return steps;
}

/** An outline's longer side: a circle's diameter, a rounded rectangle's longer side. */
function outlineLonger(outline: DiagramZoomOutline): number {
  return zoomShapeOf(outline) === 'circle' ? 2 * outline.radius! : Math.max(outline.size![0], outline.size![1]);
}

/**
 * The area the enlarge arrow before `step` leaves where the pages print one
 * (Revision 2): read from the order as it is (`zoomIndex`), and only before a
 * step that shows its window — none before one seeded with no picture yet.
 */
function arrowArea(step: DiagramStep, document: DiagramDocument, index: ZoomIndex) {
  const from = viewOfStep(step).zoom ? (index.arrowFrom.get(step.id) ?? null) : null;
  const areaStep = from ? stepsOf(document).find((each) => each.id === from.stepId) : undefined;
  const area = areaStep ? zoomAreas(areaStep).find((each) => each.id === from!.areaId) : undefined;
  return from && area ? { from, area } : null;
}

/**
 * How many enlarge arrows the diagram's pages print (Revision 2), by the
 * layout's own rule ({@link arrowArea}): what the export dialog says step
 * files leave out.
 */
export function enlargeArrowCount(document: DiagramDocument): number {
  const index = zoomIndex(document);
  return stepsOf(document).filter((step) => arrowArea(step, document, index) !== null).length;
}

/**
 * What the layout needs of an enlarged step that shows its window (Revision
 * 2): the area the arrow before it leaves ({@link arrowArea}) and the box the
 * arrow prints in, in the diagram's style; its frame and window against its
 * whole picture; and its Size. Undefined for a step that shows its whole
 * picture, or none yet.
 */
function layoutZoom(step: DiagramStep, document: DiagramDocument, index: ZoomIndex): LayoutZoom | undefined {
  const view = viewOfStep(step).zoom;
  if (!view) return undefined;
  const arrow = arrowArea(step, document, index);
  const units = wholeUnitsAcross(step, document.assets);
  return {
    arrowFrom: arrow
      ? { ...arrow.from, share: outlineLonger(zoomOutlineOf(arrow.area)), ...enlargeArrowSizes(document.style) }
      : null,
    frameShare: outlineLonger(view.frame),
    windowShare: Math.max(view.window.width, view.window.height),
    whole: units !== null ? { kind: 'paper', units } : { kind: 'fit' },
    scale: step.zoom?.scale ?? null,
  };
}

/** A scale this close to the one a picture was measured at is the one it was measured at. */
export const MEASURE_SETTLED = 1e-4;
/** How many times a picture is measured at most, for the largest scale at which it holds a room. */
const MEASURE_STEPS = 32;

/**
 * The largest scale at which a picture holds a room, measured at that scale:
 * `fitAt(scale)` its fit there as `pictureFit` reads its measure (`null`, as
 * a card's). Its letters, arrowheads and marks keep their pt size, so how far
 * they reach past it is only known at its scale. Each measure gives a reach
 * and how it grows there, so the fit it reads lands as Newton's method would:
 * a reach of straight pieces settles in a step or two. One that is not — a
 * glyph larger than its paper hides the paper's growth until the paper
 * outgrows it, and no scale is its own fit — is found between the largest
 * scale found to hold and the smallest found not to, halving the gap. Only a
 * scale found to hold is returned: the fit measured at the smallest scale
 * tried when none did.
 */
export function largestHeld(fitAt: (scale: number | null) => number | null, below = Infinity): number | null {
  let fit = fitAt(null);
  if (fit === null) return null;
  let held = 0;
  // Below a scale found not to hold, when one is known.
  let fails = below;
  let scale = Math.min(fit, below / 2);
  for (let pass = 0; pass < MEASURE_STEPS && scale > 0 && Number.isFinite(scale); pass += 1) {
    const next = fitAt(scale);
    if (next === null) break;
    fit = next;
    if (next >= scale * (1 - MEASURE_SETTLED)) {
      held = Math.max(held, scale);
      if (next <= scale * (1 + MEASURE_SETTLED)) return scale;
    } else {
      fails = Math.min(fails, scale);
    }
    if (fails <= held * (1 + MEASURE_SETTLED)) return held;
    scale = next > held && next < fails ? next : held > 0 ? Math.sqrt(held * fails) : Math.min(next, fails / 2);
  }
  return held > 0 ? held : Math.max(0, Math.min(fit, scale));
}

/** A picture as measured at one scale, in one room: its fit there, how far it hangs out of it at that scale, and its floor. */
export interface RoomMeasure {
  fit: number | null;
  overrun: number;
  floor: number;
}

/** Overruns this close, in mm, are the same: a smaller scale must hang out less than that to be drawn at. */
export const OVERRUN_SAME_MM = 0.05;
/** How many scales between a picture's floor and the largest it holds a room at are measured, when it still hangs out there. */
const OVERRUN_SAMPLES = 8;
/** How many times the scale found there is halved toward the next above it. */
const OVERRUN_HALVINGS = 12;

/**
 * The largest scale at which a picture hangs out of a room the least it can,
 * measured there (`measureAt`, a card's at null), and below `below` when
 * given: {@link largestHeld}'s, unless its marks still hang out there and a
 * smaller one, down to its floor, holds the room with them hanging out less.
 * A mark's pt-size part need not reach as far at a smaller scale — an
 * arrowhead is capped by a share of its arc — and the measure at one scale
 * cannot see that, so the scales between are measured, the least found
 * taken (the largest of those as little), and refined by halving toward the
 * next one up. Only a scale found to hold is returned.
 */
export function leastOverrunHeld(measureAt: (scale: number | null) => RoomMeasure | null, below = Infinity): number | null {
  const upper = largestHeld((scale) => measureAt(scale)?.fit ?? null, below);
  if (upper === null || !(upper > 0)) return upper;
  const there = measureAt(upper);
  if (!there || there.overrun <= OVERRUN_SAME_MM || !(there.floor < upper)) return upper;
  /** How far it hangs out at `scale`, where it holds the room there above its floor; null where it does not. */
  const overrunAt = (scale: number) => {
    const measure = measureAt(scale);
    if (!measure || measure.fit === null) return null;
    const holds = measure.fit >= scale * (1 - MEASURE_SETTLED) && scale >= measure.floor * (1 - MEASURE_SETTLED);
    return holds ? measure.overrun : null;
  };
  // Its floor up to the scale found, evenly in the log, that one last.
  const scales = Array.from({ length: OVERRUN_SAMPLES }, (_, k) => there.floor * (upper / there.floor) ** (k / OVERRUN_SAMPLES));
  const overruns = scales.map(overrunAt);
  const least = Math.min(...overruns.map((overrun) => overrun ?? Infinity));
  if (!(least < there.overrun - OVERRUN_SAME_MM)) return upper;
  // The largest scale as little: past the last measured so, toward the next one up.
  let found = overruns.length - 1;
  while (!(overruns[found] !== null && overruns[found]! <= least + OVERRUN_SAME_MM)) found -= 1;
  let held = scales[found]!;
  let fails = scales[found + 1] ?? upper;
  for (let halving = 0; halving < OVERRUN_HALVINGS && fails > held * (1 + MEASURE_SETTLED); halving += 1) {
    const middle = Math.sqrt(held * fails);
    const overrun = overrunAt(middle);
    if (overrun !== null && overrun <= least + OVERRUN_SAME_MM) held = middle;
    else fails = middle;
  }
  return held;
}

/**
 * The pages, with every picture whose marks reach past it — a References
 * step's letters and arrows, any step's annotations — fitted to its room at
 * the largest scale it holds it at, measured there (`largestHeld`): its room
 * is the page's and its text's, whatever its scale, so each is found on its
 * own, before the runs choose among them. A run may draw a picture smaller
 * than its fit, and one whose marks reach out unevenly — the reach of a
 * mark's pt-size part shrinking as the picture grows — need not hold its
 * room there; and one that holds it where it is drawn may still hang out of
 * it where a smaller scale would not, a mark that shrinks with its paper
 * (`leastOverrunHeld`). Either is drawn alone at the largest scale under
 * that which holds and hangs out least (`atMost`), its run as it was: a
 * smaller scale for one picture never draws its run's others smaller, whose
 * marks may not shrink with them. Laid out last with each picture measured
 * at the scale it is drawn at, for how far it reaches there; its fits, and
 * so the scales, are the ones found. Every picture holds its room.
 */
export function layoutDiagram(document: DiagramDocument, setter: TextSetter): DiagramPagesLayout {
  const layout = (steps: LayoutStep[]) => layoutDiagramPages(steps, document.page, document.title, setter);
  // An enlarged step's cut frame runs on past the paper by a length set in mm, as a mark's head is.
  const reaching = stepsOf(document).some(
    (step) => step.picture?.kind === 'step-diagram' || hasDrawnAnnotations(step.annotations) || viewOfStep(step).zoom !== null
  );
  if (!reaching) return layout(diagramLayoutSteps(document));
  // Each picture measured once at each scale, however often the search, the
  // layouts and the checks below ask for it.
  const measured = new Map<string, LayoutStep['picture']>();
  const pictureOf: PictureOf = (step, measure) => {
    const key = `${step.id} ${measure === null ? '' : 'mmPerUnit' in measure ? `p${measure.mmPerUnit}` : `f${measure.frameMm}`}`;
    if (!measured.has(key)) measured.set(key, layoutPicture(step, document.assets, document.style, measure));
    return measured.get(key)!;
  };
  const stepsAt = (measureOf?: (stepId: string) => PictureMeasure) => diagramLayoutSteps(document, measureOf, pictureOf);
  const entries = new Map(stepsOf(document).map((step) => [step.id, step]));
  const kinds = new Map(stepsAt().map((step) => [step.id, step.picture?.kind]));
  /** A step's picture in a room `across` × `down`, measured at `scale` (a card's at null). */
  const measureAt =
    (stepId: string, across: number, down: number) =>
    (scale: number | null): RoomMeasure | null => {
      const entry = entries.get(stepId);
      if (!entry) return null;
      const measure = scale === null ? null : kinds.get(stepId) === 'paper' ? { mmPerUnit: scale } : { frameMm: scale };
      const picture = pictureOf(entry, measure);
      if (!picture) return null;
      return {
        fit: pictureFit(picture, across, down),
        overrun: scale === null ? 0 : pictureOverrun(picture, across, down, scale),
        floor: pictureFloor(picture, across, down),
      };
    };
  const fitIn = new Map<string, NonNullable<LayoutStep['fitIn']>>();
  for (const [stepId, kind] of kinds) {
    if (!kind) continue;
    const found = new Map<string, number | null>();
    fitIn.set(stepId, (across, down) => {
      const key = `${across}|${down}`;
      if (!found.has(key)) found.set(key, largestHeld((scale) => measureAt(stepId, across, down)(scale)?.fit ?? null));
      return found.get(key)!;
    });
  }
  const atMost = new Map<string, number>();
  const fitted = (steps: LayoutStep[]) =>
    steps.map((step) => {
      const most = atMost.get(step.id);
      return { ...step, fitIn: fitIn.get(step.id), ...(most !== undefined ? { atMost: most } : {}) };
    });
  /** The pages with each picture measured at the scale `pages` drew it at, for how far it reaches there. */
  const measuredAt = (pages: DiagramPagesLayout) => {
    const drawn = scalesOf(pages);
    return layout(fitted(stepsAt((stepId) => drawn.get(stepId)?.measure ?? null)));
  };
  const pages = measuredAt(layout(fitted(stepsAt())));
  for (const cell of pages.pages.flatMap((page) => page.cells)) {
    const scale = cell.mmPerUnit ?? cell.frameMm;
    if (scale === null || !(scale > 0)) continue;
    const measure = measureAt(cell.stepId, cell.drawMm.w, cell.drawMm.h);
    const there = measure(scale);
    const holds = there?.fit !== null && there?.fit !== undefined && there.fit >= scale * (1 - MEASURE_SETTLED);
    if (holds && there!.overrun <= OVERRUN_SAME_MM) continue;
    // At or under the scale it is drawn at, where it holds and hangs out least.
    const held = leastOverrunHeld(measure, holds ? scale * (1 + MEASURE_SETTLED) : scale);
    if (held === null) continue;
    // Held where it is drawn, it is drawn smaller only where it hangs out less.
    if (holds && !((measure(held)?.overrun ?? Infinity) < there!.overrun - OVERRUN_SAME_MM)) continue;
    atMost.set(cell.stepId, held);
  }
  return atMost.size > 0 ? measuredAt(layout(fitted(stepsAt()))) : pages;
}

/** The scale each step's picture is drawn at, by its step, and the measure that is. */
function scalesOf(pages: DiagramPagesLayout): Map<string, { scale: number; measure: PictureMeasure }> {
  const scales = new Map<string, { scale: number; measure: PictureMeasure }>();
  for (const cell of pages.pages.flatMap((page) => page.cells)) {
    if (cell.mmPerUnit !== null) scales.set(cell.stepId, { scale: cell.mmPerUnit, measure: { mmPerUnit: cell.mmPerUnit } });
    else if (cell.frameMm !== null) scales.set(cell.stepId, { scale: cell.frameMm, measure: { frameMm: cell.frameMm } });
  }
  return scales;
}

/**
 * Every text a diagram's pages set, at its weight: the title, the
 * instructions and the digits, and the runs of its uploads' text and its
 * annotations' labels, each in the CJK face it was given.
 */
export function diagramFontTexts(document: DiagramDocument): DiagramFontText[] {
  return [
    { text: document.title, weight: 700 },
    ...stepsOf(document).map((step) => ({ text: step.text, weight: 400 as const })),
    ...[...diagramUploadTexts(document), ...diagramLabelTexts(document)].map(({ face, text }) =>
      face.key === 'latin' ? { text, weight: face.weight } : { text, weight: face.weight, cjk: face.key }
    ),
  ];
}

/** The runs of text the diagram's steps' labels set. */
export function diagramLabelTexts(document: DiagramDocument): UploadTextRun[] {
  return stepsOf(document).flatMap((step) => annotationTextRuns(step.annotations, document.hanStyle));
}

/** The runs of text in the uploads the diagram's steps show, each upload once. */
export function diagramUploadTexts(document: DiagramDocument): UploadTextRun[] {
  const seen = new Set<string>();
  const runs: UploadTextRun[] = [];
  for (const step of stepsOf(document)) {
    const asset = stepAsset(document, step);
    if (asset?.kind !== 'svg' || seen.has(asset.id)) continue;
    seen.add(asset.id);
    runs.push(...uploadTextRuns(asset.svg, document.hanStyle));
  }
  return runs;
}

export async function prepareDiagramPages(
  document: DiagramDocument,
  dependencies: DiagramPagesDependencies
): Promise<PreparedDiagramPages> {
  const [fonts, subsetter] = await Promise.all([
    loadDiagramFonts(diagramFontTexts(document), document.hanStyle, dependencies.fontSource),
    dependencies.subsetter(),
  ]);
  return preparedPages(document, fonts, subsetter);
}

/** The pages, with the fonts and subsetter in hand. */
export function preparedPages(
  document: DiagramDocument,
  fonts: DiagramFonts,
  subsetter: FontSubsetter
): PreparedDiagramPages {
  const setter = fontTextSetter((key, weight) => fonts.font(key, weight)?.metrics ?? null, document.hanStyle);
  const layout = layoutDiagram(document, setter);
  // An upload's text is set as its page is composed; what no font has is known now.
  for (const { face, text } of [...diagramUploadTexts(document), ...diagramLabelTexts(document)]) {
    setter.runs(text, face);
  }
  const steps = new Map(stepsOf(document).map((step) => [step.id, step]));
  const arrows = new Map<number, PlacedZoomArrow[]>();
  return {
    layout,
    setter,
    missing: [...setter.missing],
    unavailableFonts: fonts.unavailable,
    zoomArrows(index) {
      const page = layout.pages[index];
      if (!page) return [];
      let placed = arrows.get(index);
      if (!placed) {
        placed = liftedZoomArrows(page, steps, document.assets, document.style, { hanStyle: document.hanStyle, runs: setter.runs });
        arrows.set(index, placed);
      }
      return placed;
    },
    compose(index, options) {
      const page = layout.pages[index];
      if (!page) throw new RangeError(`No page ${index}`);
      return composeDiagramPage({
        layout,
        page,
        steps,
        assets: document.assets,
        style: document.style,
        hanStyle: document.hanStyle,
        setter,
        embedFonts: (usage) => embeddedFontFaces(usage, fonts, subsetter),
        band: options?.band,
      });
    },
  };
}
