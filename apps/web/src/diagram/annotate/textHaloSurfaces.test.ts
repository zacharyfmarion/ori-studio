import { beforeAll, describe, expect, it } from 'vitest';
import {
  createDiagram,
  insertSteps,
  stepsOf,
  type DiagramDocument,
  type DiagramStepZoom,
  type KnownDiagramAnnotation,
} from '../document/diagramDocument';
import { referencesStep } from '../document/diagramSteps.fixtures';
import { prepareStepFiles } from '../export/stepFiles';
import { FIXTURE_FONTS, fixtureSubsetter } from '../fonts/diagramFonts.fixtures';
import type { FontSubsetter } from '../fonts/fontSubset';
import { preparedPages } from '../pages/diagramPages';
import { stepPictureSource } from '../pictures/paintDiagramStep';
import { annotatedStepUrl, zoomedStepUrl } from '../pictures/useStepPictureUrl';
import { zoomedSource } from '../zoom/paintZoomed';

/**
 * A haloed label's halo on every surface that draws a References step (17b):
 * the face it stands on — the grey back here — on the sheet, the page's white
 * off it. Each surface hands the drawing the step's paper itself, and an
 * enlarged step hands it in its window's units, so these hold the wiring the
 * drawing's own tests take as given.
 */

let subsetter: FontSubsetter;
beforeAll(async () => {
  subsetter = await fixtureSubsetter();
});

const GREY = '#b3b3b3';
const WHITE = '#ffffff';

/** In the middle of the sheet, and past its right edge: in an enlarged step's window, 1.4 across is 0.95 of the sheet. */
const LABELS: KnownDiagramAnnotation[] = [
  { id: 'mid', kind: 'label', from: [0.5, 0.5], to: [0.5, 0.5], text: 'MID', halo: true, bold: true, sizePt: 9 },
  { id: 'edge', kind: 'label', from: [1.4, 0.5], to: [1.4, 0.5], text: 'EDGE', halo: true, sizePt: 9 },
];

/** The middle half of the sheet, enlarged: its window x 0.25 to 0.75. */
const MIDDLE: DiagramStepZoom = { from: 'area-1', shape: 'circle', frame: { centre: [0.5, 0.5], radius: 0.25 } };

/** A back References step with the two labels on it, enlarged when `zoom` is given. */
function backStep(zoom: DiagramStepZoom | null): DiagramDocument {
  const sent = referencesStep('step-back', { side: 'back' });
  const step = { ...sent, annotations: LABELS, annotatedPictureKey: sent.picture!.key, ...(zoom ? { zoom } : {}) };
  return insertSteps(createDiagram({ title: 'Halo' }), [step], 0);
}

/** Each label's halo in `svg`, by its text: the stroke on its `<text>`, or none. A page's own text is not a label. */
function halos(svg: string): Record<string, string[]> {
  const found: Record<string, string[]> = {};
  for (const [element] of svg.matchAll(/<text[^>]*>(?:<tspan[^>]*>[^<]*<\/tspan>)+<\/text>/g)) {
    const name = /<tspan[^>]*>([^<]*)<\/tspan>/.exec(element)![1]!;
    if (!LABELS.some((label) => label.text === name)) continue;
    (found[name] ??= []).push(/ stroke="([^"]*)"/.exec(element)?.[1] ?? 'none');
  }
  return found;
}

const decoded = (url: string | null) => Buffer.from(url!.replace('data:image/svg+xml;base64,', ''), 'base64').toString('utf8');

/** The step as a page, its step file and its card draw it. */
function surfaces(document: DiagramDocument) {
  const step = stepsOf(document)[0]!;
  const pages = preparedPages(document, FIXTURE_FONTS, subsetter);
  const files = prepareStepFiles(document, FIXTURE_FONTS, subsetter, {
    sameSize: false,
    number: true,
    text: true,
    widthMm: 80,
    heightMm: 100,
    transparent: false,
  });
  const zoomed = zoomedSource(step, document.assets);
  const card = zoomed
    ? zoomedStepUrl(zoomed, step.annotations, document.style, false)
    : annotatedStepUrl(stepPictureSource(step, document.assets)!, step.annotations, document.style, 1, false);
  return {
    page: halos(pages.layout.pages.map((_, index) => pages.compose(index).svg).join('')),
    file: halos(files.compose(0).svg),
    card: halos(decoded(card)),
  };
}

describe('a label’s halo on a References step’s back, as each surface draws it', () => {
  it('is the grey back on the sheet and the page’s white off it, on the page, the step file and the card', () => {
    const drawn = surfaces(backStep(null));
    const expected = { MID: [GREY], EDGE: [WHITE] };
    expect(drawn).toEqual({ page: expected, file: expected, card: expected });
  });

  it('reads an enlarged step’s labels in its window: a label past the window’s edge is still on the sheet', () => {
    const drawn = surfaces(backStep(MIDDLE));
    const expected = { MID: [GREY], EDGE: [GREY] };
    expect(drawn).toEqual({ page: expected, file: expected, card: expected });
  });
});
