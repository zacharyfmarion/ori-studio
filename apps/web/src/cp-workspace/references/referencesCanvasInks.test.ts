import { describe, expect, it } from 'vitest';
import type { Rgba } from '../renderer/types';
import { diagramDashSlot } from './diagram/diagramInk';
import {
  referencesFoldPaint,
  referencesOverlayColors,
  referencesPaperFaces,
  type ReadTokenColor,
} from './referencesCanvasInks';

// The two pen pairs apart, so a line in the wrong pair cannot pass.
const FOLD_MOUNTAIN: Rgba = [0.9, 0.1, 0.1, 1];
const FOLD_VALLEY: Rgba = [0.1, 0.1, 0.9, 1];
const DIAGRAM_MOUNTAIN: Rgba = [0.5, 0.2, 0.0, 1];
const DIAGRAM_VALLEY: Rgba = [0.0, 0.5, 0.2, 1];
const FRONT: Rgba = [1, 1, 0.2, 1];
const BACK: Rgba = [0.8, 0.8, 0.8, 1];

const TOKENS: Record<string, Rgba> = {
  '--fold-mountain': FOLD_MOUNTAIN,
  '--fold-valley': FOLD_VALLEY,
  '--diagram-mountain': DIAGRAM_MOUNTAIN,
  '--diagram-valley': DIAGRAM_VALLEY,
  '--references-paper-front': FRONT,
  '--references-paper-back': BACK,
};

/** A reader over `tokens`, answering the fallback for anything unset, as the canvas does. */
const reader =
  (tokens: Record<string, Rgba>): ReadTokenColor =>
  (name, fallback) =>
    tokens[name] ?? fallback;

describe('referencesOverlayColors', () => {
  it('draws the pattern’s creases in the fold inks, never the diagram-crease inks', () => {
    const colors = referencesOverlayColors(reader(TOKENS));
    expect(colors.mountain).toEqual(FOLD_MOUNTAIN);
    expect(colors.valley).toEqual(FOLD_VALLEY);
  });
});

describe('referencesPaperFaces', () => {
  it('puts the face the reader is on first, the back when mirrored', () => {
    expect(referencesPaperFaces(reader(TOKENS), false)).toEqual({ up: FRONT, other: BACK });
    expect(referencesPaperFaces(reader(TOKENS), true)).toEqual({ up: BACK, other: FRONT });
  });
});

describe('referencesFoldPaint', () => {
  it('pairs the step’s fold in the diagram-crease inks and slots, and the pattern’s creases in the fold ones', () => {
    const paint = referencesFoldPaint(reader(TOKENS), false);
    expect(paint.up).toEqual(FRONT);
    expect(paint.other).toEqual(BACK);
    expect(paint.directions).toEqual([
      {
        mountain: DIAGRAM_MOUNTAIN,
        valley: DIAGRAM_VALLEY,
        mountainSlot: diagramDashSlot('mountain'),
        valleySlot: diagramDashSlot('valley'),
      },
      {
        mountain: FOLD_MOUNTAIN,
        valley: FOLD_VALLEY,
        mountainSlot: diagramDashSlot('fold-mountain'),
        valleySlot: diagramDashSlot('fold-valley'),
      },
    ]);
    // Four distinct slots: a stroke's slot names its pair and its direction.
    const slots = paint.directions.flatMap((pair) => [pair.mountainSlot, pair.valleySlot]);
    expect(new Set(slots).size).toBe(4);
  });

  it('gives the step’s fold the fold inks outside the workspace, where the diagram tokens are unset', () => {
    const { '--diagram-mountain': _m, '--diagram-valley': _v, ...outside } = TOKENS;
    const [diagram] = referencesFoldPaint(reader(outside), false).directions;
    expect(diagram!.mountain).toEqual(FOLD_MOUNTAIN);
    expect(diagram!.valley).toEqual(FOLD_VALLEY);
  });
});
