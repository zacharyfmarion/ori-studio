import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { StepDiagram } from './StepDiagram';
import type { StepDiagramModel } from './referenceFinderDiagramToPrimitives';

const model = (width: number, height: number): StepDiagramModel => ({
  sheet: { width, height },
  primitives: [
    { kind: 'sheet', width, height },
    {
      kind: 'line',
      from: [0, 0],
      to: [width, height],
      style: 'valley',
    },
  ],
});

const rectOf = (markup: string) => {
  const tag = markup.match(/<rect[^>]*>/)?.[0] ?? '';
  const attr = (name: string) => Number(tag.match(new RegExp(`${name}="([^"]*)"`))?.[1]);
  return { x: attr('x'), y: attr('y'), width: attr('width'), height: attr('height') };
};

describe('the sheet a card is drawn on', () => {
  // A rect with a negative width is invalid SVG: the browser paints nothing, so
  // the paper's fill and outline both vanish and the creases float. The mirror
  // swaps which projected corner is on the left, which is exactly how that
  // happens.
  it('is a real rectangle on the back as well as the front', () => {
    for (const sheet of [model(1, 1), model(2, 1), model(1, 3)]) {
      for (const mirrored of [false, true]) {
        const rect = rectOf(
          renderToStaticMarkup(<StepDiagram primitives={sheet} size={100} mirrored={mirrored} />)
        );
        expect(rect.width, `${sheet.sheet.width}x${sheet.sheet.height} mirrored=${mirrored}`)
          .toBeGreaterThan(0);
        expect(rect.height).toBeGreaterThan(0);
        expect(rect.x).toBeGreaterThanOrEqual(0);
        expect(rect.x + rect.width).toBeLessThanOrEqual(100);
      }
    }
  });

  it('covers the same square whichever way the paper is facing', () => {
    const front = rectOf(renderToStaticMarkup(<StepDiagram primitives={model(2, 1)} size={100} />));
    const back = rectOf(
      renderToStaticMarkup(<StepDiagram primitives={model(2, 1)} size={100} mirrored />)
    );
    expect(back).toEqual(front);
  });
});
