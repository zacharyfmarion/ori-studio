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
const MEASURE_PASSES = 6;
/** A scale this close to the one its marks were measured at is the one they were measured at. */
const MEASURE_SETTLED = 1e-4;

/**
 * The pages, laid out again while a References step or an annotated one is
 * drawn at a scale other than the one its marks were measured at: its
 * letters, arrowheads and marks keep their pt size, so how far they reach
 * past its picture is only known at its scale — which depends on how far
 * they reach. Each pass measures a step at where the last two put its
 * scale's fixed point (a secant), so marks large for their room settle in a
 * few passes rather than creeping; a picture drawn smaller alone that has
 * not settled is fitted to its room as it is drawn (`cellPicture`).
 */
export function layoutDiagram(document: DiagramDocument, setter: TextSetter): DiagramPagesLayout {
  const layout = (measureOf?: (stepId: string) => PictureMeasure) =>
    layoutDiagramPages(diagramLayoutSteps(document, measureOf), document.page, document.title, setter);
  let pages = layout();
  const reaching = stepsOf(document).some(
    (step) => step.picture?.kind === 'step-diagram' || hasDrawnAnnotations(step.annotations)
  );
  if (!reaching) return pages;
  /** Per step, the scale its marks were last measured at, and the scale the layout then drew it at. */
  const tried = new Map<string, { at: number; got: number }>();
  let measures = scalesOf(pages);
  for (let pass = 0; pass < MEASURE_PASSES && measures.size > 0; pass += 1) {
    const at = measures;
    pages = layout((stepId) => at.get(stepId)?.measure ?? null);
    const got = scalesOf(pages);
    let settled = true;
    measures = new Map();
    for (const [stepId, { scale, measure }] of got) {
      const was = at.get(stepId);
      if (!was || Math.abs(scale - was.scale) > MEASURE_SETTLED * scale) settled = false;
      const next = was ? fixedPoint(tried.get(stepId), { at: was.scale, got: scale }) : scale;
      if (was) tried.set(stepId, { at: was.scale, got: scale });
      measures.set(stepId, { scale: next, measure: withScale(measure, next) });
    }
    if (settled) break;
  }
  return pages;
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

function withScale(measure: PictureMeasure, scale: number): PictureMeasure {
  if (measure === null) return null;
  return 'mmPerUnit' in measure ? { mmPerUnit: scale } : { frameMm: scale };
}

/**
 * Where a step's scale settles — the scale its marks, measured at it, give
 * back — from its last two tries: the secant's root, held between half and
 * one and a half times the latest result. The latest result alone with one try.
 */
function fixedPoint(before: { at: number; got: number } | undefined, last: { at: number; got: number }): number {
  if (!before) return last.got;
  const [f0, f1] = [before.got - before.at, last.got - last.at];
  const root = last.at - (f1 * (last.at - before.at)) / (f1 - f0);
  if (!Number.isFinite(root) || root <= 0) return last.got;
  return Math.min(1.5 * last.got, Math.max(0.5 * last.got, root));
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
