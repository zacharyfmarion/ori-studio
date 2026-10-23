import { describe, expect, it } from 'vitest';
import {
  PAPER_TILT_SHADE,
  rigidHinge,
  seenFromOtherFace,
  shownFace,
  tiltLighting,
  tiltShade,
} from './foldHinge';

describe('rigidHinge', () => {
  it('leaves the paper in place flat and mirrors it across the line folded', () => {
    const flat = rigidHinge(0).place(0.3, 0.4);
    expect(flat).toMatchObject({ s: 0.3, v: 0.4, z: 0, nz: 1, face: 1 });
    const folded = rigidHinge(Math.PI).place(0.3, 0.4);
    expect(folded.s).toBe(0.3);
    expect(folded.v).toBeCloseTo(-0.4, 12);
    expect(folded.z).toBeCloseTo(0, 12);
    expect(folded.face).toBe(-1);
  });

  it('stands the paper on edge at a quarter turn, still showing the reader its face', () => {
    const edge = rigidHinge(Math.PI / 2).place(0, 1);
    expect(edge.v).toBeCloseTo(0, 12);
    expect(edge.z).toBeCloseTo(1, 12);
    expect(edge.face).toBe(1);
    expect(rigidHinge(Math.PI / 2 + 1e-6).place(0, 1).face).toBe(-1);
  });
});

describe('shownFace', () => {
  it('is the reader’s face up to edge-on and the other past it', () => {
    expect(shownFace(1)).toBe(1);
    expect(shownFace(0)).toBe(1);
    expect(shownFace(-1e-9)).toBe(-1);
  });
});

describe('tiltShade and tiltLighting', () => {
  it('shades nothing flat, the full strength edge-on, and the same either side', () => {
    expect(tiltShade(1)).toBe(0);
    expect(tiltShade(-1)).toBe(0);
    expect(tiltShade(0)).toBe(PAPER_TILT_SHADE[3]);
    expect(tiltShade(0.5)).toBeCloseTo(PAPER_TILT_SHADE[3] / 2, 12);
    expect(tiltShade(-0.5)).toBeCloseTo(tiltShade(0.5), 12);
    expect(tiltShade(0, 0.6)).toBe(0.6);
  });

  it('is the darkening toward black as a light factor', () => {
    // Paper under the factor, as `paperFaceFill` multiplies it, is paper mixed
    // toward the black shade by the amount.
    for (const nz of [1, 0.7, 0.2, 0, -0.4]) {
      const paper = 0.9;
      const k = tiltShade(nz);
      expect(paper * tiltLighting(nz)).toBeCloseTo(paper * (1 - k) + PAPER_TILT_SHADE[0] * k, 12);
    }
    expect(tiltLighting(1)).toBe(1);
  });
});

describe('seenFromOtherFace', () => {
  it('swaps each kind of direction within its own pair and leaves the rest', () => {
    expect(seenFromOtherFace('mountain')).toBe('valley');
    expect(seenFromOtherFace('valley')).toBe('mountain');
    expect(seenFromOtherFace('diagram-mountain')).toBe('diagram-valley');
    expect(seenFromOtherFace('diagram-valley')).toBe('diagram-mountain');
    for (const role of ['edge', 'aux', 'diagram-hidden'] as const) {
      expect(seenFromOtherFace(role)).toBe(role);
    }
  });
});
