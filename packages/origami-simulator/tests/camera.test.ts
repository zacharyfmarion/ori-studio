import { describe, expect, it } from 'vitest';
import { cameraUniforms, fitExtent, projectVertices } from '../src/webgl/camera.js';

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

describe('projecting vertices the way the vertex shader does', () => {
  const camera = cameraUniforms(VIEW, CENTER, 1, 400, 300);

  /** One vertex in, its view triple and pixel pair out. */
  function project(
    position: [number, number, number],
    options?: { perspective?: boolean }
  ): { x: number; y: number; depth: number; sx: number; sy: number } {
    const out = projectVertices(new Float32Array(position), camera, options);
    return {
      x: out.view[0]!,
      y: out.view[1]!,
      depth: out.view[2]!,
      sx: out.screen[0]!,
      sy: out.screen[1]!,
    };
  }

  it('puts the model centre at the middle of the frame', () => {
    const centre = project([0, 0, 0]);
    expect(centre.sx).toBeCloseTo(200, 6);
    expect(centre.sy).toBeCloseTo(150, 6);
  });

  it('reads depth from world Y at zero pitch, because the paper lies in XZ', () => {
    // Easy to get backwards, and worth stating: at pitch 0 the camera looks
    // straight down the vertical axis, so a fold rising off the sheet moves in
    // *depth* and not up the screen. Screen-up comes from world Z.
    // DEFAULT_SIMULATOR_VIEW pitches well away from this for exactly that reason.
    const risen = project([0, 0.5, 0]);
    expect(risen.depth).toBeCloseTo(0.5, 6);
    expect(risen.sy).toBeCloseTo(150, 6);
  });

  it('flips y, because NDC y is up and pixel y is down', () => {
    // The single most consequential sign in the whole projection: get it wrong
    // and the export is a mirror image of the screen.
    expect(project([0, 0, 0.5]).sy).toBeLessThan(150);
    expect(project([0, 0, -0.5]).sy).toBeGreaterThan(150);
    expect(project([0.5, 0, 0]).sx).toBeGreaterThan(200);
  });

  it('treats larger depth as nearer the eye, and magnifies it', () => {
    // The painter's-order contract. The shader writes z = -depth/depthRange
    // under LEQUAL, so the *larger* depth wins the depth test; an exporter that
    // reads this backwards draws the model inside out.
    const near = project([0, 0.5, 0.5]);
    const far = project([0, -0.5, 0.5]);
    expect(near.depth).toBeGreaterThan(far.depth);
    // Same height off the frame centre, so any difference is the perspective.
    expect(near.y).toBeCloseTo(far.y, 6);
    expect(150 - near.sy).toBeGreaterThan(near.y * camera.scale);
    expect(150 - far.sy).toBeLessThan(far.y * camera.scale);
  });

  it('drops the perspective divide when asked, for the canvas-2D fallback', () => {
    // That renderer is orthographic, so a machine without WebGL2 must export the
    // way its own screen draws.
    const flat = project([0, 0.5, 0.5], { perspective: false });
    expect(150 - flat.sy).toBeCloseTo(flat.y * camera.scale, 6);
    expect(flat.sy).not.toBeCloseTo(project([0, 0.5, 0.5]).sy, 6);
  });

  it('measures positions relative to the camera centre', () => {
    const offCentre = cameraUniforms(VIEW, [1, 2, 3], 1, 400, 300);
    const out = projectVertices(new Float32Array([1, 2, 3]), offCentre);
    expect(out.screen[0]).toBeCloseTo(200, 6);
    expect(out.screen[1]).toBeCloseTo(150, 6);
  });

  it('yaws about Y, so a quarter turn puts +x where -z was', () => {
    const at = (yaw: number, position: [number, number, number]) =>
      projectVertices(new Float32Array(position), cameraUniforms({ ...VIEW, yaw }, CENTER, 1, 400, 300));
    const before = at(0, [0, 0, -1]);
    const after = at(Math.PI / 2, [1, 0, 0]);
    expect(after.screen[0]).toBeCloseTo(before.screen[0]!, 5);
    expect(after.screen[1]).toBeCloseTo(before.screen[1]!, 5);
  });

  it('pitches after yawing, so the two are not interchangeable', () => {
    // The shader yaws about Y and *then* pitches the result; swapping the order
    // gives a different view for any camera with both angles set, which is every
    // camera the app actually uses.
    const both = cameraUniforms({ yaw: 0.7, pitch: -0.9, zoom: 1 }, CENTER, 1, 400, 300);
    const swapped = cameraUniforms({ yaw: -0.9, pitch: 0.7, zoom: 1 }, CENTER, 1, 400, 300);
    const point = new Float32Array([0.3, 0.6, -0.2]);
    expect(projectVertices(point, both).screen[1]).not.toBeCloseTo(
      projectVertices(point, swapped).screen[1]!,
      3
    );
  });

  it('projects every vertex it is given', () => {
    const out = projectVertices(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), camera);
    expect(out.count).toBe(3);
    expect(out.view).toHaveLength(9);
    expect(out.screen).toHaveLength(6);
    expect([...out.screen].every(Number.isFinite)).toBe(true);
  });

  it('never divides by zero at the eye plane', () => {
    // camDist is 3.2 radii, so a vertex cannot normally reach the eye -- but a
    // blown-up solve puts vertices anywhere, and an Infinity here would poison
    // every downstream bound.
    const atEye = project([0, camera.camDist, 0]);
    expect(Number.isFinite(atEye.sx)).toBe(true);
    expect(Number.isFinite(atEye.sy)).toBe(true);
  });
});
