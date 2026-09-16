import { describe, expect, it } from 'vitest';
import type { StepDiagramPrimitive } from '../referenceFinderDiagramToPrimitives';
import { foldArrowArc } from '../stepDiagramGeometry';
import type { FoldScene } from './foldScene';
import { SYMBOL_FADE_ANGLE, symbolAnchor, symbolFlap, symbolOpacity } from './foldSymbolFade';

/** A unit square folded along y = 0.5, the top half swinging down. */
const FOLD: FoldScene = {
  kind: 'cp',
  flaps: [
    {
      chord: [
        { x: 0, y: 0.5 },
        { x: 1, y: 0.5 },
      ],
      side: 1,
      polygon: [
        { x: 0, y: 0.5 },
        { x: 1, y: 0.5 },
        { x: 1, y: 1 },
        { x: 0, y: 1 },
      ],
      creased: [[0, 1]],
    },
  ],
  sheetShortSide: 1,
  reach: 0.5,
};

const point = (at: [number, number]): StepDiagramPrimitive => ({ kind: 'point', at, style: 'normal' });
const label = (at: [number, number]): StepDiagramPrimitive => ({
  kind: 'label',
  at,
  text: 'P',
  style: 'normal',
});

describe('symbolFlap', () => {
  it('finds the symbols on the moving paper, and leaves the rest alone', () => {
    // On the flap: the top edge's corner and a mark in the middle of it.
    expect(symbolFlap(point([1, 1]), FOLD)).toBe(0);
    expect(symbolFlap(label([0.5, 0.75]), FOLD)).toBe(0);
    // Staying put: the bottom half, the hinge itself, and off the sheet on
    // the flap's side — where the mark a flap lands on so often is.
    expect(symbolFlap(point([0.5, 0.25]), FOLD)).toBeNull();
    expect(symbolFlap(point([0.5, 0.5]), FOLD)).toBeNull();
    expect(symbolFlap(point([0.5, 1.5]), FOLD)).toBeNull();
    expect(symbolFlap({ kind: 'sheet', width: 1, height: 1 }, FOLD)).toBeNull();
  });

  it('reads an arrow by where it leaves from', () => {
    const down = foldArrowArc([0.5, 1], [0.5, 0], [0.5, 0.5])!;
    const up = foldArrowArc([0.5, 0], [0.5, 1], [0.5, 0.5])!;
    expect(symbolFlap({ kind: 'fold-arrow', out: down }, FOLD)).toBe(0);
    expect(symbolFlap({ kind: 'fold-arrow', out: up }, FOLD)).toBeNull();
    expect(symbolAnchor({ kind: 'fold-arrow', out: down })?.y).toBeCloseTo(1);
  });

  it('takes everything along when the whole sheet turns over', () => {
    const over: FoldScene = {
      ...FOLD,
      kind: 'turn-over',
      flaps: [{ ...FOLD.flaps[0]!, whole: true }],
    };
    expect(symbolFlap(point([0.5, 0.25]), over)).toBe(0);
    expect(symbolFlap({ kind: 'turn-over', at: [0.5, 0.5] }, over)).toBe(0);
  });

  it('names the flap a symbol rides on a twin', () => {
    const twin: FoldScene = {
      ...FOLD,
      flaps: [
        FOLD.flaps[0]!,
        {
          chord: [
            { x: 0, y: 0.5 },
            { x: 1, y: 0.5 },
          ],
          side: -1,
          polygon: [
            { x: 0, y: 0 },
            { x: 1, y: 0 },
            { x: 1, y: 0.5 },
            { x: 0, y: 0.5 },
          ],
          creased: [[0, 1]],
        },
      ],
    };
    expect(symbolFlap(point([0.5, 0.75]), twin)).toBe(0);
    expect(symbolFlap(point([0.5, 0.25]), twin)).toBe(1);
  });
});

describe('symbolOpacity', () => {
  it('fades a riding symbol out over the first of the swing, and back the same way', () => {
    expect(symbolOpacity(0, null)).toBe(1);
    expect(symbolOpacity(0, { flap: 0, angle: 0, press: 0 })).toBe(1);
    const part = symbolOpacity(0, { flap: 0, angle: SYMBOL_FADE_ANGLE / 2, press: 0 });
    expect(part).toBeGreaterThan(0);
    expect(part).toBeLessThan(1);
    expect(symbolOpacity(0, { flap: 0, angle: SYMBOL_FADE_ANGLE, press: 0 })).toBe(0);
    expect(symbolOpacity(0, { flap: 0, angle: Math.PI, press: 1 })).toBe(0);
  });

  it('leaves alone a symbol that stays put, or rides a flap that is not moving', () => {
    expect(symbolOpacity(null, { flap: 0, angle: Math.PI, press: 1 })).toBe(1);
    expect(symbolOpacity(1, { flap: 0, angle: Math.PI, press: 1 })).toBe(1);
  });
});
