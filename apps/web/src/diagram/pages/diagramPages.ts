/**
 * A diagram's pages, ready to compose (D10): its fonts loaded, its steps laid
 * out with the fonts' own advances, and each page composed on demand — the
 * Pages view composes the pages in view, an export every page.
 *
 * Laid out once per call: a change to the diagram is a new call. The fonts and
 * the subsetter are kept by their modules, so a new call costs the layout and
 * the pages it composes, not a download.
 */
import { stepAsset, type DiagramDocument } from '../document/diagramDocument';
import type { DiagramFontFace } from '../fonts/diagramFontFaces';
import { loadDiagramFonts, type DiagramFontSource, type DiagramFontText, type DiagramFonts } from '../fonts/diagramFonts';
import { embeddedFontFaces } from '../fonts/fontEmbedding';
import type { FontSubsetter } from '../fonts/fontSubset';
import { composeDiagramPage, type ComposedPage } from './composeDiagramPage';
import { layoutDiagramPages, type DiagramPagesLayout, type LayoutStep, type TextSetter } from './diagramPageLayout';
import { fontTextSetter } from './fontTextSetter';
import { uploadTextRuns, type UploadTextRun } from '../upload/uploadText';
import { layoutPicture } from './pagePictures';

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

/** What the layout needs of each step, its References steps measured at `mmPerUnit` when known. */
export function diagramLayoutSteps(document: DiagramDocument, mmPerUnit: number | null = null): LayoutStep[] {
  return document.steps.map((step) => ({
    id: step.id,
    text: step.text,
    breakBefore: step.breakBefore,
    picture: layoutPicture(step, document.assets, document.style, mmPerUnit),
  }));
}

/**
 * The pages, laid out twice when a References step shares the paper scale: its
 * letters and arrowheads keep their pt size, so how far they reach past its
 * sheet is only known at the scale the first layout finds.
 */
export function layoutDiagram(document: DiagramDocument, setter: TextSetter): DiagramPagesLayout {
  const first = layoutDiagramPages(diagramLayoutSteps(document), document.page, document.title, setter);
  const sent = document.steps.some((step) => step.picture?.kind === 'step-diagram');
  if (first.mmPerUnit === null || !sent) return first;
  return layoutDiagramPages(diagramLayoutSteps(document, first.mmPerUnit), document.page, document.title, setter);
}

/**
 * Every text a diagram's pages set, at its weight: the title, the
 * instructions and the digits, and the runs of its uploads' text, each in the
 * CJK face it was given.
 */
export function diagramFontTexts(document: DiagramDocument): DiagramFontText[] {
  return [
    { text: document.title, weight: 700 },
    ...document.steps.map((step) => ({ text: step.text, weight: 400 as const })),
    ...diagramUploadTexts(document).map(({ face, text }) =>
      face.key === 'latin' ? { text, weight: face.weight } : { text, weight: face.weight, cjk: face.key }
    ),
  ];
}

/** The runs of text in the uploads the diagram's steps show, each upload once. */
export function diagramUploadTexts(document: DiagramDocument): UploadTextRun[] {
  const seen = new Set<string>();
  const runs: UploadTextRun[] = [];
  for (const step of document.steps) {
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
  for (const { face, text } of diagramUploadTexts(document)) setter.runs(text, face);
  const steps = new Map(document.steps.map((step) => [step.id, step]));
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
