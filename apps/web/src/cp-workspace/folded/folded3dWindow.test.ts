import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { cameraUniforms, fitExtent } from '@treemaker/origami-simulator';
import {
  DEFAULT_PAPER_STYLE,
  ORIEDITA_PAPER_BACK,
  ORIEDITA_PAPER_FRONT,
  ptToDevicePx,
  type PaperStyle,
} from '../../lib/paper/paperStyle';
import { lightVector } from '../../lib/paper/paperStyleResolve';
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
  FOLDED_3D_CREASE_DEPTH_BIAS,
  canWindowFolded3dFigure,
  folded3dFrameFillZoom,
  folded3dMeshPayload,
  folded3dWindowIds,
  folded3dWindowRenderSettings,
  folded3dWindowView,
} from './folded3dWindow';
import { folded3dMesh, type Folded3dMesh } from './folded3dMesh';
import {
  FOLDED_3D_CAMERA_DISTANCE_FACTOR,
  FOLDED_3D_SILHOUETTE_FACTOR,
  folded3dFrameHalfSide,
} from './folded3dFrame';
import { TRANSPARENT_FACE_ALPHA, UNDETERMINED_FACE_ALPHA } from './folded3dStyle';

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
  it('restates the camera distance the simulator fits with', () => {
    // The silhouette factor is derived from `cameraUniforms`'s eye distance,
    // which the simulator does not export. If that constant moves, the frame
    // is sized for the wrong perspective and a model can leave its own box.
    const camera = cameraUniforms({ yaw: 0, pitch: 0, zoom: 1 }, [0, 0, 0], 1, 512, 512);
    expect(camera.camDist).toBeCloseTo(FOLDED_3D_CAMERA_DISTANCE_FACTOR, 12);
    // r · d / √(d² − r²) at r = 1: a 5.3% growth, F11's number.
    expect(FOLDED_3D_SILHOUETTE_FACTOR).toBeCloseTo(1.0527, 4);
    expect(folded3dFrameHalfSide(40)).toBeCloseTo(40 * FOLDED_3D_SILHOUETTE_FACTOR, 12);
  });

  it('fits the model’s perspective silhouette, not its radius, to its frame', () => {
    // Re-pinned for D7: the window draws with the mesh renderer's perspective
    // since Phase 1, so the frame is the bounding sphere's *silhouette*
    // (`folded3dFrameHalfSide`), and the fill zoom cancels both
    // `cameraUniforms`'s 8%-a-side padding and the silhouette factor — the
    // radius maps to `shortEdge / (2 · factor)` so the silhouette exactly
    // touches the edge. Fitting the radius to the whole edge, as the
    // orthographic window did, would let the model escape its box at every
    // orientation by the 5% the perspective adds.
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
      // scale maps world units to pixels; a unit-radius model's silhouette is
      // `FOLDED_3D_SILHOUETTE_FACTOR` wide and spans the short edge exactly.
      expect(camera.scale * 2 * FOLDED_3D_SILHOUETTE_FACTOR).toBeCloseTo(
        Math.min(width!, height!),
        6
      );
    }
  });

  it('is derived from fitExtent rather than from its constant', () => {
    // So it stays exact if the padding is ever retuned.
    expect(folded3dFrameFillZoom(512, 512)).toBeCloseTo(
      512 / fitExtent(512, 512) / FOLDED_3D_SILHOUETTE_FACTOR,
      12
    );
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

/**
 * Distinctive colours so a settings field that reads the wrong source is
 * obvious, over the default pens and light.
 */
const STYLE: PaperStyle = {
  ...DEFAULT_PAPER_STYLE,
  paper: { front: '#ff8040', back: '#1a334d' },
  edges: { ...DEFAULT_PAPER_STYLE.edges, color: '#666666' },
  mountainFolds: { ...DEFAULT_PAPER_STYLE.mountainFolds, color: '#ff0000' },
  valleyFolds: { ...DEFAULT_PAPER_STYLE.valleyFolds, color: '#0000ff' },
};

describe('drawing a figure in its effective paper style', () => {
  it('takes the paper colours from the style, not from the simulator settings', () => {
    const settings = folded3dWindowRenderSettings({
      style: STYLE,
      displayStyle: 'Paper5',
      devicePixelRatio: 1,
    });
    expect(settings.frontColor.map((c) => Math.round(c * 255))).toEqual([255, 128, 64]);
    expect(settings.backColor.map((c) => Math.round(c * 255))).toEqual([26, 51, 77]);
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

  it('inks the folds with the M/V pens and the borders with the edge pen, as the simulator does', () => {
    // Re-pinned: every crease kind took the edge pen while the folded-3d
    // policy had no fold pens; Phase 5 gave it them, so a 3D figure draws
    // its creases as the simulator draws a fold.
    const settings = folded3dWindowRenderSettings({
      style: STYLE,
      displayStyle: 'Paper5',
      devicePixelRatio: 1,
    });
    expect(settings.mountainColor).toEqual([1, 0, 0]);
    expect(settings.valleyColor).toEqual([0, 0, 1]);
    expect(settings.borderColor).toEqual([0.4, 0.4, 0.4]);
  });

  it('draws every fold line at the mountain pen’s pt width in device pixels, and nothing bespoke', () => {
    // Phase 1 replaced the window's own `1.5 × dpr` with a pen; Phase 5's
    // policy makes that pen the mountain pen's width, the simulator's fold
    // line weight, under the resolver's one-width rule (re-pinned from the
    // edge pen's own 0.9 pt). The below-reference shrink is the viewport's
    // (`creaseWidthReferenceEdge`), not this module's.
    for (const dpr of [1, 2]) {
      const settings = folded3dWindowRenderSettings({
        style: {
          ...STYLE,
          edges: { ...STYLE.edges, width: 0.9 },
          mountainFolds: { ...STYLE.mountainFolds, width: 1.2 },
        },
        displayStyle: 'Paper5',
        devicePixelRatio: dpr,
      });
      expect(settings.creaseWidthPx).toBeCloseTo(ptToDevicePx(1.2, dpr), 12);
      expect(settings.creaseWidthReferenceEdge).toBeUndefined();
    }
  });

  it('carries the aux pen, its toggle and erode to the window', () => {
    // A 0° fold is an aux crease now (`folded3dEdgeAssignment`); the window
    // draws it in this pen when the effective style shows aux creases, and
    // erodes by the style's fraction of the mesh's sheet per frame.
    const settings = folded3dWindowRenderSettings({
      style: {
        ...STYLE,
        auxCreases: { visible: true, pen: { width: 0.75, color: '#00ff00', dash: null, cap: 'butt' } },
        erode: 0.03,
      },
      displayStyle: 'Paper5',
      devicePixelRatio: 2,
    });
    expect(settings.showAux).toBe(true);
    expect(settings.auxColor).toEqual([0, 1, 0]);
    expect(settings.auxWidthPx).toBeCloseTo(ptToDevicePx(0.75, 2), 12);
    expect(settings.erode).toBe(0.03);
    expect(
      folded3dWindowRenderSettings({
        style: { ...STYLE, auxCreases: { ...STYLE.auxCreases, visible: false } },
        displayStyle: 'Paper5',
        devicePixelRatio: 1,
      }).showAux
    ).toBe(false);
  });

  it('is lit from the style’s light, the same one the simulator uses', () => {
    // D7: the 3D figure renders exactly as the simulator does, so the light is
    // data from the style rather than the on-axis constant the window had.
    const lit = folded3dWindowRenderSettings({
      style: { ...STYLE, light: { enabled: true, azimuth: 30, elevation: 40 } },
      displayStyle: 'Paper5',
      devicePixelRatio: 1,
    });
    expect(lit.lighting).toBe(true);
    expect(lit.lightDir).toEqual(lightVector(30, 40));
    const unlit = folded3dWindowRenderSettings({
      style: { ...STYLE, light: { enabled: false, azimuth: 30, elevation: 40 } },
      displayStyle: 'Paper5',
      devicePixelRatio: 1,
    });
    expect(unlit.lighting).toBe(false);
  });

  it('draws the defaults as the Oriedita figure it replaces', () => {
    // Behaviour-preserving for a following figure: the default style's paper is
    // Oriedita's, so a figure that pins nothing looks as it did.
    const settings = folded3dWindowRenderSettings({
      style: DEFAULT_PAPER_STYLE,
      displayStyle: 'Paper5',
      devicePixelRatio: 1,
    });
    expect(ORIEDITA_PAPER_FRONT).toBe('#ffff32');
    expect(settings.frontColor.map((c) => Math.round(c * 255))).toEqual([255, 255, 50]);
    expect(ORIEDITA_PAPER_BACK).toBe('#e9e9e9');
    expect(settings.backColor.map((c) => Math.round(c * 255))).toEqual([233, 233, 233]);
    expect(settings.borderColor).toEqual([0, 0, 0]);
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

  it('keeps the crease depth rules the fold-line draw order relies on', () => {
    const settings = folded3dWindowRenderSettings({
      style: STYLE,
      displayStyle: 'Paper5',
      devicePixelRatio: 1,
    });
    expect(settings.creaseDepthBias).toBe(FOLDED_3D_CREASE_DEPTH_BIAS);
    expect(settings.creaseWritesDepth).toBe(false);
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
