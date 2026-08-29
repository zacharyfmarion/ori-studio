import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createCpSuppressionRegion } from '../annotations/suppressionRegion';
import type { RegionDrawProps } from './programs/regionProgram';
import type { ViewTransform } from './types';
import type { CpRenderFrame } from './CpRenderer';

/**
 * What the renderer decides about the region layer, as opposed to what the
 * shader does with it: which regions are worth a draw call, what order they
 * stack in, and where the wash colour comes from.
 *
 * The colour is the interesting one. It is resolved inside `render` from the
 * canvas's own theme custom property rather than uploaded with the geometry, so
 * a theme switch repaints with no re-upload and no call site having to remember
 * to re-run — and this is what pins that, since nothing else would notice a
 * hardcoded colour.
 */

const draws: RegionDrawProps[] = [];

vi.mock('regl', () => ({
  default: () => ({
    poll: () => {},
    clear: () => {},
    destroy: () => {},
    buffer: () => ({ destroy: () => {} }),
    texture: () => ({ destroy: () => {} }),
    on: () => ({ cancel: () => {} }),
  }),
}));

const noopProgram = () => ({ setData: () => {}, draw: () => {}, dispose: () => {} });
vi.mock('./programs/strokeProgram', () => ({ createStrokeProgram: noopProgram }));
vi.mock('./programs/pointProgram', () => ({ createPointProgram: noopProgram }));
vi.mock('./programs/fillProgram', () => ({ createFillProgram: noopProgram }));
vi.mock('./programs/markerProgram', () => ({ createMarkerProgram: noopProgram }));
vi.mock('./programs/wedgeProgram', () => ({ createWedgeProgram: noopProgram }));
vi.mock('./programs/imageProgram', () => ({ createImageProgram: noopProgram }));
vi.mock('./programs/regionProgram', () => ({
  createRegionProgram: () => ({
    draw: (props: RegionDrawProps) => {
      draws.push(props);
    },
    dispose: () => {},
  }),
}));

const { createReglRenderer } = await import('./reglRenderer');

const VIEW: ViewTransform = { origin: [0, 0], ex: [1, 0], ey: [0, 1] };

const FRAME: CpRenderFrame = {
  clearColor: [0, 0, 0, 1],
  view: VIEW,
  userView: VIEW,
  strokeWidthPx: 1,
  userScalePx: 1,
  markerScalePx: 1,
  pointScalePx: 1,
  constantOutlinePx: 1,
  markerOutlinePx: 1,
  pointOutlinePx: 1,
  pointOpacity: 1,
};

function region(overrides: Partial<Parameters<typeof createCpSuppressionRegion>[0]> = {}) {
  return createCpSuppressionRegion({
    center: { x: 100, y: 200 },
    width: 40,
    height: 20,
    ...overrides,
  });
}

/** Render one frame with `regions` uploaded; returns the single draw's props. */
function renderRegions(
  regions: ReturnType<typeof region>[],
  dpr = 1
): RegionDrawProps | undefined {
  const renderer = createReglRenderer(document.createElement('canvas'));
  renderer.resize({ width: 100, height: 100, dpr });
  renderer.setRegions(regions);
  renderer.render(FRAME);
  renderer.dispose();
  return draws[0];
}

beforeEach(() => {
  draws.length = 0;
});

describe('reglRenderer suppression regions', () => {
  it('does not draw the layer at all when there are no regions', () => {
    renderRegions([]);

    expect(draws).toHaveLength(0);
  });

  it('carries placement, rotation and the region opacity through to the draw', () => {
    const props = renderRegions([
      region({ center: { x: 3, y: 4 }, width: 40, height: 20, rotation: 0.5, opacity: 0.6 }),
    ]);

    expect(props?.items).toEqual([
      { center: [3, 4], halfWidth: 20, halfHeight: 10, rotation: 0.5, opacity: 0.6 },
    ]);
  });

  it('stacks regions back-to-front by z, like the image layer', () => {
    const props = renderRegions([
      region({ center: { x: 1, y: 1 }, z: 5 }),
      region({ center: { x: 2, y: 2 }, z: -1 }),
      region({ center: { x: 3, y: 3 }, z: 2 }),
    ]);

    expect(props?.items.map((item) => item.center)).toEqual([
      [2, 2],
      [3, 3],
      [1, 1],
    ]);
  });

  /**
   * These cost a draw call and put nothing on screen. A zero-size region is
   * reachable mid-drag, before the creation gesture has swept any area.
   */
  it('skips degenerate and fully transparent regions', () => {
    renderRegions([
      region({ width: 0 }),
      region({ height: 0 }),
      region({ opacity: 0 }),
    ]);

    expect(draws).toHaveLength(0);
  });

  /**
   * A region is never `hidden` — the type forbids it, because a suppressor you
   * cannot see is the one state the design rules out — so there is no hidden
   * skip for the builder to apply, and a region always draws where it suppresses.
   */
  it('draws a region that suppresses nothing, because it still scopes the box', () => {
    const props = renderRegions([region({ suppress: [] })]);

    expect(props?.items).toHaveLength(1);
  });

  it('falls back to the theme warning hue when the custom property is unset', () => {
    const props = renderRegions([region()]);

    // #d7a85c, the default theme's --status-warning.
    expect(props?.fill.slice(0, 3)).toEqual([0.843, 0.659, 0.361]);
    expect(props?.border.slice(0, 3)).toEqual([0.843, 0.659, 0.361]);
  });

  it('washes at a low alpha and borders at a high one, from the same hue', () => {
    const props = renderRegions([region()]);

    expect(props?.fill[3]).toBeLessThan(0.2);
    expect(props?.border[3]).toBeGreaterThan(props?.fill[3] ?? 1);
    expect(props?.fill.slice(0, 3)).toEqual(props?.border.slice(0, 3));
  });

  it('scales the hairline border by the device pixel ratio', () => {
    expect(renderRegions([region()], 1)?.borderWidthPx).toBe(1);
    draws.length = 0;
    expect(renderRegions([region()], 2)?.borderWidthPx).toBe(2);
  });
});
