/// <reference types="@webgpu/types" />
// Render checks for the WebGPU mesh renderer, run by webgpuSpike.bench.ts or
// by hand from the harness page.
//
// The WebGL2 renderer is the reference picture: each fixture is folded once on
// the CPU, written into both GPU solvers, and drawn by both renderers with the
// same camera and settings. The pictures are compared pixel by pixel. They are
// not expected to be bit-identical — two rasterizers' antialiased edges
// disagree by a few levels — but a shading, depth, dash or projection bug
// changes whole regions, which is what the share of differing pixels catches.
import { prepareFoldModel } from '../../src/prepare.js';
import { OrigamiModel } from '../../src/model.js';
import { ReferenceSolver } from '../../src/referenceSolver.js';
import { createSolverShape } from '../../src/solverBackend.js';
import { WebglSolver } from '../../src/webgl/webglSolver.js';
import { boundingRadius, cameraUniforms, centroid } from '../../src/webgl/camera.js';
import type { RenderSettings } from '../../src/webgl/meshRenderer.js';
import { GpuCore } from '../../src/webgpu/gpuCore.js';
import { WebgpuSolver } from '../../src/webgpu/webgpuSolver.js';
import { FIXTURES } from '../fixtures.js';
import type { CanvasRow, RenderReport, RenderRow } from './report.js';

const SIZE = 128;
/** A channel this far apart counts as a different pixel: past antialiasing noise. */
const PIXEL_TOLERANCE = 24;

const SETTINGS: RenderSettings = {
  frontColor: [0.31, 0.51, 0.84],
  backColor: [0.95, 0.94, 0.9],
  mountainColor: [0.86, 0.12, 0.14],
  valleyColor: [0.11, 0.36, 0.85],
  borderColor: [0.16, 0.18, 0.2],
  lightDir: [-0.45, 0.58, 0.68],
  background: [0.05, 0.06, 0.07],
  showFaces: true,
  showEdges: true,
  lighting: true,
  edgeWidthPx: 3,
  mountainWidthPx: 3,
  valleyWidthPx: 3,
  faceAlpha: 1,
  creaseDash: { border: null, mountain: [6, 3], valley: [2, 2] },
};

function close(a: Uint8Array, i: number, b: Uint8Array, j: number): boolean {
  return (
    Math.abs(a[i]! - b[j]!) <= PIXEL_TOLERANCE &&
    Math.abs(a[i + 1]! - b[j + 1]!) <= PIXEL_TOLERANCE &&
    Math.abs(a[i + 2]! - b[j + 2]!) <= PIXEL_TOLERANCE
  );
}

/**
 * Share of pixels in `a` with nothing like them within one pixel in `b`.
 *
 * A plain per-pixel count measures antialiasing: two rasterizers cover an
 * edge's pixels differently, and a dense model at this size is nearly all
 * crease ribbon, so it is nearly all edge. Looking one pixel around forgives
 * that and any sub-pixel shift, while a wrong colour, a missing face, a depth
 * order flipped or a dash gone still differs over a region.
 */
function differingShare(a: Uint8Array, b: Uint8Array, size = SIZE): number {
  let differ = 0;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const i = (y * size + x) * 4;
      let matched = false;
      for (let dy = -1; dy <= 1 && !matched; dy += 1) {
        for (let dx = -1; dx <= 1 && !matched; dx += 1) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
          matched = close(a, i, b, (ny * size + nx) * 4);
        }
      }
      if (!matched) differ += 1;
    }
  }
  return differ / (size * size);
}

/** Pixels that differ at all, for the highlight checks, which compare one renderer with itself. */
function anyDifference(a: Uint8Array, b: Uint8Array): boolean {
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return true;
  return false;
}

/** GL reads rows bottom to top; WebGPU's copy is top to bottom. */
function flipRows(pixels: Uint8Array, width: number, height: number): Uint8Array {
  const out = new Uint8Array(pixels.length);
  for (let row = 0; row < height; row += 1) {
    out.set(pixels.subarray(row * width * 4, (row + 1) * width * 4), (height - 1 - row) * width * 4);
  }
  return out;
}

function coverageOf(pixels: Uint8Array): number {
  const bg = SETTINGS.background.map((c) => Math.round(c * 255));
  let covered = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    if (Math.abs(pixels[i]! - bg[0]!) > 6 || Math.abs(pixels[i + 1]! - bg[1]!) > 6 || Math.abs(pixels[i + 2]! - bg[2]!) > 6) covered += 1;
  }
  return covered / (pixels.length / 4);
}

async function renderFixture(core: GpuCore, fixture: (typeof FIXTURES)[number]): Promise<RenderRow> {
  const row: RenderRow = {
    fixture: fixture.name,
    coverage: 0,
    differs: Number.NaN,
    differsStrain: Number.NaN,
    differsXray: Number.NaN,
    highlightTints: false,
    highlightOnlyWhenAsked: false,
  };
  const model = new OrigamiModel(prepareFoldModel(fixture.build(), { triangulate: true }));
  // One folded state, from the reference, written into both GPU solvers.
  const reference = new ReferenceSolver(model, { foldPercent: 60 });
  reference.step(150);
  const vertices = model.prepared.vertexCount;
  const shape = createSolverShape(vertices, model.prepared.creaseParams.length);
  reference.readShape(shape);
  const positions = model.positions.slice(0, vertices * 3);
  const center = centroid(positions);
  const camera = cameraUniforms({ yaw: 0.4, pitch: 0.38, zoom: 1 }, center, boundingRadius(positions, center), SIZE, SIZE);

  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const gl = new WebglSolver(canvas, new OrigamiModel(prepareFoldModel(fixture.build(), { triangulate: true })), { foldPercent: 60 });
  const gpu = await WebgpuSolver.create(new OrigamiModel(prepareFoldModel(fixture.build(), { triangulate: true })), { foldPercent: 60 }, core);
  try {
    gl.writeShape(shape, false);
    gpu.writeShape(shape, false);
    const both = async (settings: RenderSettings, options: { highlight?: boolean } = {}) => ({
      gl: flipRows(gl.renderToImage(camera, settings, SIZE, SIZE, options), SIZE, SIZE),
      gpu: await gpu.renderToPixels(camera, settings, options),
    });
    const plain = await both(SETTINGS);
    row.coverage = coverageOf(plain.gpu);
    row.differs = differingShare(plain.gl, plain.gpu);
    // Strain is zero in a written shape; a clip of 0 still exercises the ramp.
    const strain = await both({ ...SETTINGS, colorMode: 'strain', strainClip: 5 });
    row.differsStrain = differingShare(strain.gl, strain.gpu);
    const xray = await both({ ...SETTINGS, faceAlpha: 0.5 });
    row.differsXray = differingShare(xray.gl, xray.gpu);

    const facesOnly = { ...SETTINGS, showEdges: false };
    const triangles = model.prepared.indices.length / 3;
    gpu.setHighlightTriangles(Array.from({ length: Math.ceil(triangles / 2) }, (_, t) => t));
    const unlit = await gpu.renderToPixels(camera, facesOnly);
    const tinted = await gpu.renderToPixels(camera, facesOnly, { highlight: true });
    const unasked = await gpu.renderToPixels(camera, facesOnly);
    row.highlightTints = anyDifference(unlit, tinted);
    row.highlightOnlyWhenAsked = !anyDifference(unlit, unasked);
  } catch (error) {
    row.error = error instanceof Error ? error.message : String(error);
  } finally {
    const context = (gl as unknown as { gl: { gl: WebGL2RenderingContext } }).gl.gl;
    gl.dispose();
    context.getExtension('WEBGL_lose_context')?.loseContext();
    gpu.dispose();
  }
  return row;
}

/**
 * The session's path: a WebGPU context on an OffscreenCanvas, drawn to and
 * presented through createImageBitmap. On its own device, last: on SwiftShader
 * presenting a WebGPU canvas destroys the device (plain WebGPU calls do it
 * too, in a page or a worker), so this can only pass on real hardware.
 */
async function canvasPresents(fixture: (typeof FIXTURES)[number]): Promise<CanvasRow> {
  const core = await GpuCore.create();
  const gpu = await WebgpuSolver.create(new OrigamiModel(prepareFoldModel(fixture.build(), { triangulate: true })), { foldPercent: 60 }, core);
  try {
    gpu.step(150);
    const positions = new Float32Array(gpu.vertexCount * 3);
    await gpu.readPositionsAsync(positions);
    const center = centroid(positions);
    const camera = cameraUniforms({ yaw: 0.4, pitch: 0.38, zoom: 1 }, center, boundingRadius(positions, center), SIZE, SIZE);
    const offscreen = new OffscreenCanvas(SIZE, SIZE);
    gpu.attachCanvas(offscreen);
    gpu.render(camera, SETTINGS);
    const bitmap = await createImageBitmap(offscreen, 0, 0, SIZE, SIZE);
    const probe = new OffscreenCanvas(SIZE, SIZE).getContext('2d')!;
    probe.drawImage(bitmap, 0, 0);
    bitmap.close();
    const presented = new Uint8Array(probe.getImageData(0, 0, SIZE, SIZE).data.buffer);
    return { presents: coverageOf(presented) > 0.02, deviceLost: core.lost };
  } catch (error) {
    return { presents: false, deviceLost: core.lost, error: error instanceof Error ? error.message : String(error) };
  } finally {
    if (!core.lost) gpu.dispose();
    core.dispose();
  }
}

export async function runRenderChecks(core: GpuCore): Promise<RenderReport> {
  const rows: RenderRow[] = [];
  for (const fixture of FIXTURES) {
    if (fixture.degenerate) continue;
    rows.push(await renderFixture(core, fixture));
  }
  return { rows, canvas: await canvasPresents(FIXTURES.find((fixture) => !fixture.degenerate)!) };
}
