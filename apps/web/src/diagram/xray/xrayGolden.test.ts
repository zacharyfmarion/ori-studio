import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import golden from './__fixtures__/xrayGolden.json';
import { XRAY_CASES } from './xray.cases';
import { xraySurfaces } from './xray.surfaces';

/** A box's numbers to a millionth: what the golden keeps of a frame. */
const box = ({ x, y, width, height }: { x: number; y: number; width: number; height: number }) =>
  Object.fromEntries(Object.entries({ x, y, width, height }).map(([key, value]) => [key, Number(value.toFixed(6))]));

/**
 * X-rays (Revision 3, 18f) as each surface paints them — the canvas, a card,
 * a page and Pose's ghost — recorded when they were made and checked by eye
 * beside Zach's note (`artifacts/revision-3/18f/`): inside a rim 1.5 times
 * the edges' pen, the page's white over the faces it takes away — and off
 * the paper nothing, since 18f's review — and the faces left in their side's
 * colour, each outlined in the edges' pen, at their print weight on each
 * surface; on an enlarged step held to the frame inside its cut; in Pose the
 * rim alone. Each surface's windows and the frame they are drawn on.
 *
 * Recorded again with `XRAY_GOLDEN_WRITE=1`, after looking at what changed.
 */
const surfaces = Object.fromEntries(
  XRAY_CASES.map(({ id, step }) => {
    const { canvas, card, page, pose } = xraySurfaces(step);
    return [
      id,
      {
        canvas: canvas.windows,
        card: { frame: box(card.frame), windows: card.windows },
        page: { frame: box(page.frame), reach: box(page.boundsPt), windows: page.windows },
        pose: pose.windows,
      },
    ];
  })
);

if (process.env.XRAY_GOLDEN_WRITE) {
  const path = join(dirname(fileURLToPath(import.meta.url)), '__fixtures__', 'xrayGolden.json');
  writeFileSync(path, `${JSON.stringify(surfaces, null, 1)}\n`);
}

describe('an x-ray', () => {
  it.each(XRAY_CASES.map((entry) => [entry.id] as const))('%s paints as recorded on the canvas, a card, a page and in Pose', (id) => {
    expect(surfaces[id]).toEqual((golden as Record<string, unknown>)[id]);
  });
});
