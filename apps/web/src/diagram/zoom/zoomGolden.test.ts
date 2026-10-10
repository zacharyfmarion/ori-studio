import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import golden from './__fixtures__/zoomGolden.json';
import { ZOOM_CASES } from './zoom.cases';
import { areaSurfaces, zoomSurfaces } from './zoom.surfaces';

/**
 * Enlarged steps (16d) as each surface paints them — a card, a page and the
 * canvas — recorded when they were made and checked by eye beside Zach's two
 * examples (`artifacts/revision-2/16d/shots/goldens.png`): the window of the
 * step's own picture, its pens at their print weight, clipped to its frame;
 * a circle's boundary only where it crosses paper and a little past, a
 * rounded rectangle's whole, an upload's whole; the marks over it in the
 * window's units; and on the step before, the area's outline in the ring's
 * pen, a rounded rectangle's on its white casing.
 *
 * Recorded again with `ZOOM_GOLDEN_WRITE=1`, after looking at what changed.
 */
const surfaces = Object.fromEntries(
  ZOOM_CASES.map((entry) => [
    entry.id,
    {
      enlarged: zoomSurfaces(entry.step, entry.assets),
      ...(entry.before ? { area: areaSurfaces(entry.before, entry.assets) } : {}),
    },
  ])
);

if (process.env.ZOOM_GOLDEN_WRITE) {
  const path = join(dirname(fileURLToPath(import.meta.url)), '__fixtures__', 'zoomGolden.json');
  writeFileSync(path, `${JSON.stringify(surfaces, null, 1)}\n`);
}

describe('an enlarged step', () => {
  it.each(ZOOM_CASES.map((entry) => [entry.id] as const))('%s paints as recorded on a card, a page and the canvas', (id) => {
    expect(surfaces[id]).toEqual((golden as Record<string, unknown>)[id]);
  });
});
