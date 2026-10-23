/**
 * Display layers: the faces a flat crease cuts one piece of paper into,
 * joined again, on folds small enough to read by hand
 * (`foldedPrecrease.fixtures.ts`).
 */
import { describe, expect, it } from 'vitest';
import { displayLayerOutlines, foldedDisplayLayers } from './foldedDisplayLayers';
import {
  kernelFace,
  plainBook,
  precreasedBook,
  precreasedFlap,
  PRECREASED_BOOK,
  PRECREASED_FLAP,
} from './foldedPrecrease.fixtures';

const EPSILON = 1e-9;

describe('foldedDisplayLayers', () => {
  it('joins each leaf’s two faces across the precrease, and never one leaf with the other', () => {
    // The precrease runs through both leaves in one place: each leaf has its
    // own flat edge there, named by its own sheet vertices.
    const { layerOf, layers } = foldedDisplayLayers(precreasedBook());
    const { underHigh, underLow, overHigh, overLow } = PRECREASED_BOOK;
    expect(layers).toEqual([
      [underHigh, underLow].sort(),
      [overHigh, overLow].sort(),
    ]);
    expect(layerOf[underHigh]).toBe(layerOf[underLow]);
    expect(layerOf[overHigh]).toBe(layerOf[overLow]);
    expect(layerOf[underHigh]).not.toBe(layerOf[overHigh]);
  });

  it('leaves faces across a fold, or with no flat crease at all, apart', () => {
    expect(foldedDisplayLayers(plainBook()).layers).toEqual([[0], [1]]);
    // The flap's strip is two faces across the precrease; the flap is over it, across a fold.
    expect(foldedDisplayLayers(precreasedFlap()).layers).toEqual([
      [PRECREASED_FLAP.left, PRECREASED_FLAP.right],
      [PRECREASED_FLAP.flap],
    ]);
  });

  it('joins only faces that show one side and both call the edge flat, and leaves an unnamed face alone', () => {
    // One piece of the leaf beneath showing its other side: not one isometry, so apart.
    const turned = precreasedBook();
    turned.faces[PRECREASED_BOOK.underLow]!.front_up = false;
    expect(foldedDisplayLayers(turned).layers).toHaveLength(3);

    const folded = precreasedBook();
    // One side calls it a fold: it is not one piece of paper.
    folded.faces[PRECREASED_BOOK.underHigh]!.edges[0]!.kind = 'fold';
    expect(foldedDisplayLayers(folded).layers).toHaveLength(3);

    const unnamed = precreasedBook();
    unnamed.faces[PRECREASED_BOOK.underLow]!.points = [];
    expect(foldedDisplayLayers(unnamed).layers).toHaveLength(3);
  });
});

describe('displayLayerOutlines', () => {
  it('merges a precreased leaf into the face it would be, without the precrease’s ends', () => {
    const kernel = precreasedBook();
    const layers = foldedDisplayLayers(kernel);
    const [under, over] = displayLayerOutlines(kernel, layers, EPSILON);
    // Counter-clockwise from the least vertex, the precrease's ends 6, 7 and 8 left out.
    expect(under?.points).toEqual([0, 1, 4, 3]);
    expect(under?.outline).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
    ]);
    // The leaf folded over is laid mirrored: its rings run clockwise, and are turned.
    expect(over?.points).toEqual([1, 4, 5, 2]);
  });

  it('keeps a face with no flat crease exactly as it is', () => {
    const kernel = plainBook();
    const outlines = displayLayerOutlines(kernel, foldedDisplayLayers(kernel), EPSILON);
    outlines.forEach((outline, face) => {
      expect(outline?.points).toBe(kernel.faces[face]!.points);
      expect(outline?.outline).toBe(kernel.faces[face]!.outline);
    });
  });

  it('keeps a point where a fold ends on the precrease’s line, and drops one only a flat crease made', () => {
    // The strip of the flap fold, precreased at x = 1: its ends are flat-only.
    const flap = precreasedFlap();
    const [strip] = displayLayerOutlines(flap, foldedDisplayLayers(flap), EPSILON);
    expect(strip?.points).toEqual([0, 2, 6, 4]);
    // Give the top end a fold from elsewhere: the point is a corner the paper has without the precrease.
    flap.faces.push(kernelFace([[1, 1], [1, 2], [0, 2]], [5, 9, 8], ['fold', 'border', 'border']));
    const [kept] = displayLayerOutlines(flap, foldedDisplayLayers(flap), EPSILON);
    expect(kept?.points).toEqual([0, 2, 6, 5, 4]);
  });

  it('has no outline for a layer with a hole in it, nor for one with a face it cannot name', () => {
    // A frame of four flat-joined pieces round a square hole.
    const ring = [
      kernelFace([[0, 0], [3, 0], [3, 1], [2, 1], [1, 1], [0, 1]], [0, 1, 2, 3, 4, 5], ['border', 'border', 'flat', 'border', 'flat', 'border']),
      kernelFace([[2, 1], [3, 1], [3, 2], [2, 2]], [3, 2, 6, 7], ['flat', 'border', 'flat', 'border']),
      kernelFace([[0, 2], [1, 2], [2, 2], [3, 2], [3, 3], [0, 3]], [8, 9, 7, 6, 10, 11], ['flat', 'border', 'flat', 'border', 'border', 'border']),
      kernelFace([[0, 1], [1, 1], [1, 2], [0, 2]], [5, 4, 9, 8], ['flat', 'border', 'flat', 'border']),
    ];
    const frame = { faces: ring };
    const joined = foldedDisplayLayers(frame);
    expect(joined.layers).toEqual([[0, 1, 2, 3]]);
    expect(displayLayerOutlines(frame, joined, EPSILON)).toEqual([null]);

    // Unnamed, a face is a layer of its own with no outline; the piece it was joined to keeps its own.
    const book = precreasedBook();
    book.faces[PRECREASED_BOOK.underLow]!.points = [];
    const layers = foldedDisplayLayers(book);
    const outlines = displayLayerOutlines(book, layers, EPSILON);
    expect(outlines[layers.layerOf[PRECREASED_BOOK.underLow]!]).toBeNull();
    expect(outlines[layers.layerOf[PRECREASED_BOOK.underHigh]!]?.points).toEqual([6, 7, 4, 3]);
  });
});
