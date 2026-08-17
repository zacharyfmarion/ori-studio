import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { cameraUniforms, fitExtent } from '@treemaker/origami-simulator';
import type {
  OristudioCpFolded3dRenderModel,
  OristudioCpFoldedFigureEntry,
} from '../../engine/oristudioCpTypes';
import { SIMULATOR_MAX_ZOOM, SIMULATOR_MIN_ZOOM } from '../../lib/simulatorOrbit';
import {
  resetFolded3dRenderModels,
  setFolded3dRenderModel,
} from './folded3dRenderModels';
import {
  canWindowFolded3dFigure,
  folded3dFrameFillZoom,
  folded3dMeshPayload,
  folded3dWindowIds,
  folded3dWindowRenderSettings,
  folded3dWindowView,
} from './folded3dWindow';
import { folded3dMesh, type Folded3dMesh } from './folded3dMesh';
import {
  TRANSPARENT_FACE_ALPHA,
  UNDETERMINED_FACE_ALPHA,
  folded3dPaperStyle,
  type Folded3dPaperStyle,
} from './folded3dStyle';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '__fixtures__');

function fixture(name: string): OristudioCpFolded3dRenderModel {
  return JSON.parse(readFileSync(join(FIXTURES, `${name}.rendermodel.json`), 'utf8'));
}

function meshOf(name: string): Folded3dMesh {
  const result = folded3dMesh(fixture(name));
  if (result.kind !== 'mesh') throw new Error(`fixture ${name} did not mesh`);
  return result.mesh;
}

function figure(
  overrides: Partial<OristudioCpFoldedFigureEntry> = {}
): OristudioCpFoldedFigureEntry {
  return {
    id: 'folded-1',
    title: 'Folded model 1',
    handle: 7,
    sourceKind: 'generated-from-current-cp',
    sourceCpRevision: 1,
    startingFaceId: 1,
    displayStyle: 'Paper5',
    status: 'ready',
    snapshot: null,
    folded3d: { model: {} } as never,
    renderSnapshot: {} as never,
    frameRadius: 40,
    placement: { offset: { x: 0, y: 0 }, scale: 1, rotation: 0 },
    error: null,
    ...overrides,
  } as OristudioCpFoldedFigureEntry;
}

const GPU = { gpuAvailable: true };

afterEach(() => {
  resetFolded3dRenderModels();
});

describe('deciding which figures become windows', () => {
  it('windows a 3D figure that has its geometry, a frame and a GPU', () => {
    setFolded3dRenderModel(7, fixture('pinwheel'));
    expect(canWindowFolded3dFigure(figure(), GPU)).toBe(true);
  });

  it('leaves a flat figure exactly where it is', () => {
    // The non-negotiable: the flat folded figure does not change, in any respect.
    setFolded3dRenderModel(7, fixture('pinwheel'));
    expect(canWindowFolded3dFigure(figure({ folded3d: null }), GPU)).toBe(false);
  });

  it('leaves every figure in the scene without WebGL2', () => {
    // A folded figure already has a correct picture, so "no GPU" means keep
    // drawing it — not an empty box and a badge, which is the honest answer for
    // an inline simulation and the wrong one here.
    setFolded3dRenderModel(7, fixture('pinwheel'));
    expect(canWindowFolded3dFigure(figure(), { gpuAvailable: false })).toBe(false);
  });

  it('leaves a figure whose geometry is gone in the scene', () => {
    // A figure reopened from a file has no render model: it draws its stored
    // snapshot and cannot be meshed until Phase 5 makes it live.
    expect(canWindowFolded3dFigure(figure(), GPU)).toBe(false);
  });

  it('leaves a figure with no frame in the scene', () => {
    // Without `frameRadius` the box is the bounds of the last projection, which
    // change on every orbit frame. As a window that is a per-frame layout write,
    // which wakes the canvas's ResizeObserver and re-renders it — the exact
    // failure the placement module exists to prevent.
    setFolded3dRenderModel(7, fixture('pinwheel'));
    expect(canWindowFolded3dFigure(figure({ frameRadius: null }), GPU)).toBe(false);
    expect(canWindowFolded3dFigure(figure({ frameRadius: 0 }), GPU)).toBe(false);
  });

  it('collects the windowed ids, and only those', () => {
    setFolded3dRenderModel(7, fixture('pinwheel'));
    const ids = folded3dWindowIds(
      [figure(), figure({ id: 'folded-2', handle: 99 }), figure({ id: 'folded-3', folded3d: null })],
      GPU
    );
    expect([...ids]).toEqual(['folded-1']);
  });
});

describe('framing a figure inside its window', () => {
  it('cancels the viewport padding so the model fills its frame', () => {
    // A figure's frame is its bounding sphere: the window is already exactly the
    // model's size, so `cameraUniforms`'s 8%-a-side viewport padding would draw
    // every existing 3D figure about 16% smaller in the same box.
    for (const [width, height] of [
      [512, 512],
      [200, 320],
      [97, 64],
    ]) {
      const zoom = folded3dFrameFillZoom(width!, height!);
      const camera = cameraUniforms(
        { yaw: 0, pitch: 0, zoom },
        [0, 0, 0],
        1,
        width!,
        height!
      );
      // scale maps world units to pixels, so a unit-radius model spans the short
      // edge exactly.
      expect(camera.scale * 2).toBeCloseTo(Math.min(width!, height!), 6);
    }
  });

  it('is derived from fitExtent rather than from its constant', () => {
    // So it stays exact if the padding is ever retuned.
    expect(folded3dFrameFillZoom(512, 512)).toBeCloseTo(512 / fitExtent(512, 512), 12);
  });

  it('takes the figure’s angles and its zoom', () => {
    // The mesh camera is where a figure's zoom is honoured, and the only place:
    // the frame it is drawn in is the model's bounding sphere and does not move
    // with the eye, so this grows the model inside a window of fixed size.
    expect(folded3dWindowView({ yaw: 0.4, pitch: -0.9, zoom: 3 })).toEqual({
      yaw: 0.4,
      pitch: -0.9,
      zoom: 3,
    });
  });

  it('clamps a stored zoom to the range the wheel can reach', () => {
    // A camera off a file cannot put a figure somewhere its own gestures could
    // not take it back from.
    expect(folded3dWindowView({ yaw: 0, pitch: 0, zoom: 99 }).zoom).toBe(SIMULATOR_MAX_ZOOM);
    expect(folded3dWindowView({ yaw: 0, pitch: 0, zoom: 0.001 }).zoom).toBe(SIMULATOR_MIN_ZOOM);
  });

  it('falls back to the fold camera for a figure that carries none', () => {
    expect(folded3dWindowView(null).zoom).toBe(1);
    expect(folded3dWindowView(null).yaw).toBeCloseTo(Math.PI / 4, 12);
  });
});

/** A default kernel figure model — the alphas a real figure actually gets. */
const PAPER_MODEL = {
  front_color: { red: 255, green: 255, blue: 50 },
  back_color: { red: 233, green: 233, blue: 233 },
  line_color: { red: 0, green: 0, blue: 0 },
  anti_alias: true,
  transparent_transparency: 16,
} as unknown as Parameters<typeof folded3dPaperStyle>[0];

/**
 * Distinctive colours so a settings field that reads the wrong source is
 * obvious, over the alphas a real figure actually gets.
 *
 * `transparentAlpha` comes from `folded3dPaperStyle` rather than being written
 * out: it was hardcoded at the flat renderer's `16/255`, which is exactly the
 * value that made X-ray look like Wireframe, and a fixture that pins the wrong
 * number is a test agreeing with the bug.
 */
const STYLE: Folded3dPaperStyle = {
  ...folded3dPaperStyle(PAPER_MODEL),
  front: [1, 0.5, 0.25],
  back: [0.1, 0.2, 0.3],
  line: [0.4, 0.4, 0.4],
};

describe('drawing a figure in its own colours', () => {
  it('takes the paper colours from the figure, not from the simulator settings', () => {
    const settings = folded3dWindowRenderSettings({
      style: STYLE,
      displayStyle: 'Paper5',
      devicePixelRatio: 1,
    });
    expect(settings.frontColor).toEqual([1, 0.5, 0.25]);
    expect(settings.backColor).toEqual([0.1, 0.2, 0.3]);
  });

  it('draws X-ray as paper you can see through, not as Wireframe', () => {
    // The regression this pins: X-ray took its alpha from
    // `transparent_transparency`, whose 16/255 default is calibrated for the
    // *flat* renderer's ply — ten to fourteen layers on one pixel, accumulating
    // to about 59%. A 3D pixel has one to three faces behind it, so 6% read as
    // nothing and X-ray became indistinguishable from Wireframe.
    const xray = folded3dWindowRenderSettings({
      style: STYLE,
      displayStyle: 'Transparent3',
      devicePixelRatio: 1,
    });
    const wire = folded3dWindowRenderSettings({
      style: STYLE,
      displayStyle: 'Wire2',
      devicePixelRatio: 1,
    });

    // Wireframe draws no paper at all; X-ray draws paper.
    expect(wire.showFaces).toBe(false);
    expect(xray.showFaces).toBe(true);
    // And the paper it draws has to be *visible*. A bound rather than the
    // constant, because the point is legibility rather than a particular
    // number — but low enough that the flat renderer's 0.06 fails it.
    expect(xray.faceAlpha).toBeGreaterThan(0.2);
    expect(xray.faceAlpha).toBeLessThan(1);
  });

  it('inks every crease kind with the figure’s one line colour', () => {
    // Reproduces today's single-ink linework exactly. The mesh does carry
    // mountain/valley codes, so telling them apart is a colour change away —
    // but that is a new appearance, not this phase.
    const settings = folded3dWindowRenderSettings({
      style: STYLE,
      displayStyle: 'Paper5',
      devicePixelRatio: 1,
    });
    expect(settings.mountainColor).toEqual([0.4, 0.4, 0.4]);
    expect(settings.valleyColor).toEqual([0.4, 0.4, 0.4]);
    expect(settings.borderColor).toEqual([0.4, 0.4, 0.4]);
  });

  it('maps every display style onto faces, edges and alpha', () => {
    const at = (displayStyle: 'None0' | 'Wire2' | 'Transparent3' | 'Paper5') =>
      folded3dWindowRenderSettings({ style: STYLE, displayStyle, devicePixelRatio: 1 });
    expect(at('None0')).toMatchObject({ showFaces: false, showEdges: false });
    expect(at('Wire2')).toMatchObject({ showFaces: false, showEdges: true });
    expect(at('Paper5')).toMatchObject({ showFaces: true, showEdges: true, faceAlpha: 1 });
    // The X-ray alpha is a 3D constant, *not* the model's
    // `transparent_transparency`. That field is calibrated for the flat
    // renderer's ply and reads as nothing here — see `TRANSPARENT_FACE_ALPHA`.
    expect(at('Transparent3')).toMatchObject({
      showFaces: true,
      faceAlpha: TRANSPARENT_FACE_ALPHA,
    });
  });

  it('never paints the frame, so the crease pattern shows through', () => {
    expect(
      folded3dWindowRenderSettings({ style: STYLE, displayStyle: 'Paper5', devicePixelRatio: 2 })
        .backgroundAlpha
    ).toBe(0);
  });
});

describe('handing a mesh to the worker', () => {
  it('sends copies, so the mesh survives to be uploaded again', () => {
    // The buffers are transferred, which detaches them. Transferring the mesh's
    // own arrays would leave an evicted figure with nothing to reload from — and
    // would empty the arrays the vector export reads.
    const mesh = meshOf('pinwheel');
    const { payload, transferables } = folded3dMeshPayload(mesh);
    expect(payload.faceIndices).not.toBe(mesh.topology.faceIndices.buffer);
    expect(transferables).toHaveLength(4);
    // Same contents, different buffer.
    expect([...new Uint32Array(payload.faceIndices)]).toEqual([...mesh.topology.faceIndices]);
    expect(mesh.topology.faceIndices.length).toBeGreaterThan(0);
  });

  it('packs the positions into the texture the shader samples', () => {
    const mesh = meshOf('pinwheel');
    const { payload } = folded3dMeshPayload(mesh);
    const dim = mesh.topology.textureDim;
    expect(payload.textureDim).toBe(dim);
    expect(new Float32Array(payload.positions)).toHaveLength(dim * dim * 4);
    // RGB from the tight array, alpha untouched.
    const packed = new Float32Array(payload.positions);
    expect(packed[0]).toBeCloseTo(mesh.positions[0]!, 6);
    expect(packed[2]).toBeCloseTo(mesh.positions[2]!, 6);
    expect(packed[3]).toBe(0);
  });

  it('carries the skins, the ranges and the alpha the second pass draws at', () => {
    const mesh = meshOf('pinwheel');
    const { payload } = folded3dMeshPayload(mesh);
    expect(payload.skins).toBe(mesh.skins);
    expect(payload.translucent).toBe(mesh.translucent);
    expect(payload.undetermined).toBe(mesh.undetermined);
    expect(payload.undeterminedFaceAlpha).toBe(UNDETERMINED_FACE_ALPHA);
  });

  it('reports the fit the figure’s own frame was sized from', () => {
    // The window is `2 · frameRadius` across, so a different radius here would
    // draw the model at a different size than its own chrome.
    const mesh = meshOf('box_90');
    const { payload } = folded3dMeshPayload(mesh);
    expect(payload.radius).toBe(mesh.radius);
    expect(payload.center).toEqual([0, 0, 0]);
  });
});
