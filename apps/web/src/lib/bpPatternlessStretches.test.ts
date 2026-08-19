import { describe, expect, it } from 'vitest';
import { bpPatternlessStretchVisuals } from './bpPatternlessStretches';
import { bpPackingFlapClearanceRect, bpPackingPaperRect } from './bpPackingViewport';
import type {
  OristudioBpFlap,
  OristudioBpSheet,
  OristudioBpStretch,
} from '../engine/oristudioBpTypes';

const sheet: OristudioBpSheet = {
  kind: 'rectangular',
  width: 20,
  height: 20,
  grid: { kind: 'rectangular', interval: 1, snap: true },
};
const paperRect = bpPackingPaperRect(sheet);

function flap(id: number, x: number, y: number): OristudioBpFlap {
  return {
    id,
    vertexId: id,
    name: '',
    anchor: { x, y },
    width: 0,
    height: 0,
    radius: 1,
    constrained: true,
  };
}

function stretch(overrides: Partial<OristudioBpStretch> = {}): OristudioBpStretch {
  return {
    id: '1,2',
    flapIds: [1, 2],
    riverIds: [],
    completed: true,
    configIndex: 0,
    configCount: 1,
    patternIndex: 0,
    patternCount: 1,
    patternFound: true,
    regions: [],
    ...overrides,
  };
}

describe('bpPatternlessStretchVisuals', () => {
  const flaps = [flap(1, 4, 4), flap(2, 12, 12)];

  it('ignores stretches that found a pattern', () => {
    const visuals = bpPatternlessStretchVisuals(
      { stretches: [stretch()], flaps },
      sheet,
      paperRect,
      new Set(),
    );

    expect(visuals).toEqual([]);
  });

  it('rings the clearance of every flap in a patternless stretch', () => {
    const visuals = bpPatternlessStretchVisuals(
      { stretches: [stretch({ patternFound: false })], flaps },
      sheet,
      paperRect,
      new Set(),
    );

    expect(visuals).toHaveLength(1);
    expect(visuals[0].flaps).toEqual([
      bpPackingFlapClearanceRect(flaps[0], sheet, paperRect),
      bpPackingFlapClearanceRect(flaps[1], sheet, paperRect),
    ]);
  });

  it('skips flap ids the packing no longer has', () => {
    const visuals = bpPatternlessStretchVisuals(
      { stretches: [stretch({ patternFound: false, flapIds: [1, 99] })], flaps },
      sheet,
      paperRect,
      new Set(),
    );

    expect(visuals[0].flaps).toHaveLength(1);
  });

  it('maps a grid-space region to SVG space, flipping the y axis', () => {
    const visuals = bpPatternlessStretchVisuals(
      {
        stretches: [
          stretch({ patternFound: false, regions: [{ x: 4, y: 4, width: 8, height: 8 }] }),
        ],
        flaps,
      },
      sheet,
      paperRect,
      new Set(),
    );

    const unit = paperRect.width / 20;
    expect(visuals[0].regions).toHaveLength(1);
    expect(visuals[0].regions[0].x).toBeCloseTo(paperRect.x + 4 * unit);
    // Grid y=4 is the region's bottom, so its SVG top is the y=12 edge.
    expect(visuals[0].regions[0].y).toBeCloseTo(paperRect.y + paperRect.height - 12 * unit);
    expect(visuals[0].regions[0].width).toBeCloseTo(8 * unit);
    expect(visuals[0].regions[0].height).toBeCloseTo(8 * unit);
  });

  it('marks only the selected stretch active', () => {
    const visuals = bpPatternlessStretchVisuals(
      {
        stretches: [
          stretch({ id: '1,2', patternFound: false }),
          stretch({ id: '3,4', flapIds: [], patternFound: false }),
        ],
        flaps,
      },
      sheet,
      paperRect,
      new Set(['3,4']),
    );

    expect(visuals.map((visual) => [visual.id, visual.active])).toEqual([
      ['1,2', false],
      ['3,4', true],
    ]);
  });
});
