// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest';
import { PT_PER_MM } from '../../lib/paper/paperSvg';
import { createDiagram, createStep, insertSteps, type DiagramDocument } from '../document/diagramDocument';
import { fixedPicture } from '../document/diagramSteps.fixtures';
import { FIXTURE_FONTS, fixtureSubsetter } from '../fonts/diagramFonts.fixtures';
import type { FontSubsetter } from '../fonts/fontSubset';
import { preparedPages, type PreparedDiagramPages } from '../pages/diagramPages';
import { diagramPdfInput } from './diagramPdf';
import { diagramPageFiles } from './diagramPageFiles';

let subsetter: FontSubsetter;
beforeAll(async () => {
  subsetter = await fixtureSubsetter();
});

const PICTURE_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="10" viewBox="0 0 20 10"><path d="M0 0L20 10" stroke="#000"/></svg>';

/** `count` steps, each with a picture and a sentence, in a flow of 3 × 3 a page. */
function diagram(count: number): DiagramDocument {
  const steps = Array.from({ length: count }, (_, index) => ({
    ...createStep(() => `step-${index}`),
    picture: fixedPicture(`fixed-${index}`, PICTURE_SVG),
    text: index % 2 === 0 ? 'Fold in half.' : 'Unfold, then fold the corner up.',
  }));
  return insertSteps(createDiagram({ title: 'Crane' }), steps, 0);
}

/** A document without its one style: what is drawn, and on what page. */
const unstyled = (svg: string) => svg.replace(/<defs><style>[\s\S]*?<\/style><\/defs>/, '');

describe('diagramPageFiles', () => {
  it('writes each page as the PDF prints it, a page of its own with no ground added under it', () => {
    const document = diagram(20);
    const prepared = preparedPages(document, FIXTURE_FONTS, subsetter);
    const files = diagramPageFiles(prepared, 'Crane');
    const pdf = diagramPdfInput(document, FIXTURE_FONTS, subsetter, 'home');
    expect(files.length).toBeGreaterThan(1);
    expect(files.map(({ fileStem }) => fileStem)).toEqual(files.map((_, index) => `Crane-page-${index + 1}`));
    files.forEach(({ page }, index) => {
      expect(page.widthPt).toBeCloseTo(210 * PT_PER_MM);
      expect(page.heightPt).toBeCloseTo(297 * PT_PER_MM);
      expect(page.svg).toMatch(/^<\?xml[^>]*\?>\n<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" width="[\d.]+pt" height="[\d.]+pt" viewBox="0 0 /);
      expect(unstyled(page.svg)).toBe(unstyled(pdf.pages[index]!));
    });
  });

  it('embeds in each page the faces it sets, cut to that page’s own characters', () => {
    const files = diagramPageFiles(preparedPages(diagram(20), FIXTURE_FONTS, subsetter), 'Crane');
    for (const { page } of files) {
      const faces = [...page.svg.matchAll(/@font-face\{font-family:'([^']*)';font-weight:(\d+)/g)].map(
        (match) => `${match[1]} ${match[2]}`
      );
      // Regular for the instructions, Bold for the numbers.
      expect(faces).toEqual(['Noto Sans 400', 'Noto Sans 700']);
      expect(page.svg.match(/<style>/g)).toHaveLength(1);
    }
  });

  it('pads the page numbers to the width of the page count, as step files are', () => {
    const prepared = {
      layout: { pages: Array.from({ length: 12 }, () => ({})) },
      compose: (index: number) => ({ svg: `<svg>${index}</svg>`, widthPt: 1, heightPt: 2 }),
    } as unknown as PreparedDiagramPages;
    const files = diagramPageFiles(prepared, 'Crane & Frog');
    expect(files.map(({ fileStem }) => fileStem).slice(0, 2)).toEqual(['Crane & Frog-page-01', 'Crane & Frog-page-02']);
    expect(files.at(-1)).toEqual({ fileStem: 'Crane & Frog-page-12', page: { svg: '<svg>11</svg>', widthPt: 1, heightPt: 2 } });
  });
});
