import { describe, expect, it } from 'vitest';
import { cameraUniforms, fitExtent } from '../src/webgl/camera.js';

const CENTER: [number, number, number] = [0, 0, 0];
const VIEW = { yaw: 0, pitch: 0, zoom: 1 };

/** Fraction of the frame's short edge the model spans. */
function span(edge: number): number {
  return fitExtent(edge, edge) / edge;
}

describe('fitting a model to the frame', () => {
  it('spans the same fraction of the frame at every size', () => {
    // The property that matters: the fit is a similarity. An inline simulation
    // window is sized by the crease-pattern zoom, so its drawing buffer sweeps
    // this whole range as you zoom, and anything size-dependent here reads as
    // the model shrinking faster than the window that holds it.
    const fraction = span(512);
    for (const edge of [64, 96, 128, 200, 350, 512, 1024, 2048]) {
      expect(span(edge)).toBeCloseTo(fraction, 6);
    }
  });

  it('scales the model with the frame rather than faster than it', () => {
    // Halve the frame, halve the model. Under the old `max(28px, 8%)` padding a
    // 512 -> 128 step shrank the model by 4.8x instead of 4x, and 512 -> 64 by
    // 27x instead of 8x.
    const at = (edge: number) =>
      cameraUniforms(VIEW, CENTER, 1, edge, edge).scale;
    expect(at(256) / at(512)).toBeCloseTo(0.5, 6);
    expect(at(128) / at(512)).toBeCloseTo(0.25, 6);
    expect(at(64) / at(512)).toBeCloseTo(0.125, 6);
  });

  it('fits to the short edge, so a wide frame does not overflow vertically', () => {
    expect(fitExtent(1000, 200)).toBeCloseTo(fitExtent(200, 200), 6);
    expect(fitExtent(200, 1000)).toBeCloseTo(fitExtent(200, 200), 6);
  });

  it('leaves a margin rather than filling the frame edge to edge', () => {
    expect(span(512)).toBeGreaterThan(0.5);
    expect(span(512)).toBeLessThan(1);
  });

  it('stays positive at a degenerate size', () => {
    // A transferred canvas can be measured before layout, and a zero-scale
    // camera would divide the projection by nothing.
    expect(fitExtent(0, 0)).toBeGreaterThan(0);
    expect(cameraUniforms(VIEW, CENTER, 0, 0, 0).scale).toBeGreaterThan(0);
  });

  it('scales with zoom independently of the frame', () => {
    const base = cameraUniforms(VIEW, CENTER, 1, 512, 512).scale;
    const zoomed = cameraUniforms({ ...VIEW, zoom: 2 }, CENTER, 1, 512, 512).scale;
    expect(zoomed / base).toBeCloseTo(2, 6);
  });
});
