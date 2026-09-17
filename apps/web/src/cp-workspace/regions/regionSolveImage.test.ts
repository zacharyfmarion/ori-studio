import { describe, expect, it } from 'vitest';
import { createCpImage } from '../images/cpImage';
import { createCpSuppressionRegion } from '../annotations/suppressionRegion';
import { measureRegionSourceImage, regionSourceQuad } from './regionSolveImage';

const frame = { origin: { x: 0, y: 0 }, ux: [1, 0] as [number, number],
  uy: [0, 1] as [number, number], flip: 1, side: 400 };
const image = () => createCpImage({ src: 'data:image/png;base64,AA==', naturalWidth: 1024,
  naturalHeight: 1024, center: { x: 200, y: 200 }, width: 400 * 1024 / 960,
  height: 400 * 1024 / 960 });

describe('region source-image frame', () => {
  it('uses the actual image inset, including a rotated and moved drawing', () => {
    const original = image();
    const q = regionSourceQuad(original, frame)!;
    expect(q.top_left.x).toBeCloseTo(32, 10);
    expect(q.bottom_right.y).toBeCloseTo(992, 10);
    const moved = { ...original, rotation: Math.PI / 2, center: { x: 800, y: 1000 } };
    const rotated = { origin: { x: 1000, y: 800 }, ux: [0, 1] as [number, number],
      uy: [-1, 0] as [number, number], side: 400, flip: 1 };
    const result = regionSourceQuad(moved, rotated)!;
    for (const k of ['top_left', 'top_right', 'bottom_right', 'bottom_left'] as const) {
      expect(result[k].x).toBeCloseTo(q[k].x, 10);
      expect(result[k].y).toBeCloseTo(q[k].y, 10);
    }
  });
  it('honors an image crop and solver reflection', () => {
    const cropped = { ...image(), width: 400, height: 400, crop: { x: .1, y: .2, w: .6, h: .5 } };
    const q = regionSourceQuad(cropped, { ...frame, origin: { x: 0, y: 400 }, flip: -1 })!;
    expect(q.top_left.x).toBeCloseTo(102.4);
    expect(q.top_left.y).toBeCloseTo(716.8);
    expect(q.bottom_right.x).toBeCloseTo(716.8);
    expect(q.bottom_right.y).toBeCloseTo(204.8);
  });
  it('keeps the rebuilt input when there is no attached image or no overlap', async () => {
    const input = { live: true };
    const region = createCpSuppressionRegion({ center: { x: 200, y: 200 }, width: 410, height: 410, suppress: [] });
    expect(await measureRegionSourceImage(input, frame, region, [])).toEqual({ input, seconds: 0 });
    expect(regionSourceQuad(image(), { ...frame, origin: { x: 2000, y: 0 } })).toBeNull();
  });
});
