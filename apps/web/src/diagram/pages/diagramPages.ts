/**
 * A diagram's pages, ready to compose (D10): its fonts loaded, its steps laid
 * out with the fonts' own advances, and each page composed on demand — the
 * Pages view composes the pages in view, an export every page.
 *
 * Laid out once per call: a change to the diagram is a new call. The fonts and
 * the subsetter are kept by their modules, so a new call costs the layout and
 * the pages it composes, not a download.
 */
import { isLockedTurn, isTurn, stepAsset, stepsOf, type DiagramDocument } from '../document/diagramDocument';
import type { DiagramFontFace } from '../fonts/diagramFontFaces';
import { loadDiagramFonts, type DiagramFontSource, type DiagramFontText, type DiagramFonts } from '../fonts/diagramFonts';
import { embeddedFontFaces } from '../fonts/fontEmbedding';
import type { FontSubsetter } from '../fonts/fontSubset';
import { composeDiagramPage, type ComposedPage } from './composeDiagramPage';
import {
  layoutDiagramPages,
  pictureFit,
  type DiagramPagesLayout,
  type LayoutStep,
  type LayoutTurn,
  type TextSetter,
} from './diagramPageLayout';
import { fontTextSetter } from './fontTextSetter';
import { uploadTextRuns, type UploadTextRun } from '../upload/uploadText';
import { layoutPicture, type PictureMeasure } from './pagePictures';
import { annotationTextRuns } from '../annotate/annotationPrimitives';
import { hasDrawnAnnotations } from '../annotate/paintAnnotations';

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
  /** Page `index` (from 0) as an SVG document. */
  compose: (index: number) => ComposedPage;
}

/**
 * What the layout needs of each step, its marks measured at the size a first
 * layout found for it when known (`measureOf`); each with the turns between
 * it and the step before (D22), the last with any after it.
 */
export function diagramLayoutSteps(
  document: DiagramDocument,
  measureOf: (stepId: string) => PictureMeasure = () => null
): LayoutStep[] {
  const steps: LayoutStep[] = [];
  let turns: LayoutTurn[] = [];
  for (const entry of document.steps) {
    if (isTurn(entry)) {
      // A newer build's turn is this build's to carry, not to draw.
      if (isLockedTurn(entry)) continue;
      const { id, unknown: _unknown, ...turn } = entry;
      turns.push({ id, turn });
      continue;
    }
    steps.push({
      id: entry.id,
      text: entry.text,
      breakBefore: entry.breakBefore,
      picture: layoutPicture(entry, document.assets, document.style, measureOf(entry.id)),
      turnsBefore: turns,
      turnsAfter: [],
    });
    turns = [];
  }
  const last = steps.at(-1);
  if (last && turns.length > 0) steps[steps.length - 1] = { ...last, turnsAfter: turns };
  return steps;
}

/** How many times the pages may be laid out again to measure marks at the scale they are drawn at. */
const MEASURE_PASSES = 8;
/** A scale this close to the one its marks were measured at is the one they were measured at. */
const MEASURE_SETTLED = 1e-4;

/**
 * The pages, laid out again while a References step or an annotated one is
 * drawn at a scale other than the one its marks were measured at: its
 * letters, arrowheads and marks keep their pt size, so how far they reach
 * past its picture is only known at its scale — which depends on how far
 * they reach. Each pass measures every step at the scale the last drew it at,
 * reach and slope (`layoutPicture`), so the next fits it as Newton's method
 * would: a reach of straight pieces settles in a few passes. Should one not
 * settle — a mark that jumps as the picture grows — the last pages that held
 * every picture as measured at its own scale are kept, else the last.
 */
export function layoutDiagram(document: DiagramDocument, setter: TextSetter): DiagramPagesLayout {
  const layout = (steps: LayoutStep[]) => layoutDiagramPages(steps, document.page, document.title, setter);
  let pages = layout(diagramLayoutSteps(document));
  const reaching = stepsOf(document).some(
    (step) => step.picture?.kind === 'step-diagram' || hasDrawnAnnotations(step.annotations)
  );
  if (!reaching) return pages;
  let held: DiagramPagesLayout | null = null;
  for (let pass = 0; pass < MEASURE_PASSES; pass += 1) {
    const drawn = scalesOf(pages);
    if (drawn.size === 0) return pages;
    // Every picture measured at the scale these pages drew it at.
    const steps = diagramLayoutSteps(document, (stepId) => drawn.get(stepId)?.measure ?? null);
    if (holdsEvery(pages, steps)) held = pages;
    const next = layout(steps);
    const got = scalesOf(next);
    const settled =
      got.size === drawn.size &&
      [...got].every(([stepId, { scale }]) => {
        const was = drawn.get(stepId);
        return was !== undefined && Math.abs(scale - was.scale) <= MEASURE_SETTLED * scale;
      });
    pages = next;
    if (settled) return pages;
  }
  return held ?? pages;
}

/** Whether each cell's room holds its picture with its marks, measured (`steps`) at the scale it is drawn at. */
function holdsEvery(pages: DiagramPagesLayout, steps: readonly LayoutStep[]): boolean {
  const byId = new Map(steps.map((step) => [step.id, step]));
  return pages.pages.every((page) =>
    page.cells.every((cell) => {
      const scale = cell.mmPerUnit ?? cell.frameMm;
      const picture = byId.get(cell.stepId)?.picture;
      if (scale === null || !picture) return true;
      const fit = pictureFit(picture, cell.drawMm.w, cell.drawMm.h);
      return fit !== null && fit >= scale * (1 - MEASURE_SETTLED);
    })
  );
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
  return {
    layout,
    setter,
    missing: [...setter.missing],
    unavailableFonts: fonts.unavailable,
    compose(index) {
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
      });
    },
  };
}
