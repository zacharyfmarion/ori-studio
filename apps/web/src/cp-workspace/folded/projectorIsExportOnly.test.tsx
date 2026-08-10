import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useWorkspaceStore } from '../../store/workspaceStore';
import type {
  OristudioCpFolded3dRenderModel,
  OristudioCpFolded3dSnapshot,
  OristudioCpFoldedFigureEntry,
  OristudioCpFoldedFigureModel,
} from '../../engine/oristudioCpTypes';
import { defaultFolded3dCamera, folded3dFrameRadius } from './foldedFigure3dProjection';
import { project3dRenderSnapshot, reproject3dFigureAt } from './folded3dReproject';
import { setFolded3dRenderModel, resetFolded3dRenderModels } from './folded3dRenderModels';
import { clearAllFolded3dOrbits, getFolded3dOrbit } from './folded3dRuntime';
import { useFoldedFigures } from './useFoldedFigures';

/**
 * R6: the CPU projector has left the live path.
 *
 * `foldedFigure3dProjection.ts` is not deleted and is not meant to be — it is the
 * one thing that can turn a render model into a **vector** drawing with the
 * kernel's exact layer order, which is what an `.osf`, a crease-pattern export
 * and a standalone SVG all need, and what a figure falls back to when there is no
 * GPU. What it stopped being is a *per-frame* path.
 *
 * So the statement worth pinning is not "nothing calls it" — the store calls it,
 * deliberately, whenever the exportable picture goes out of date. It is that the
 * three paths that run at pointer rate never do:
 *
 * - every pointermove of a turn,
 * - every notch of a zoom, and the settle behind it,
 * - every drawn frame, which is the mesh and a uniform.
 *
 * The risk this guards is drift between two renderers of one figure kind: a
 * projection built sixty times a second and thrown away is invisible until it is
 * slow, and a projection quietly *not* rebuilt when it should be is invisible
 * until someone exports.
 *
 * WebGL is reported as available because none of this is true of a figure that
 * cannot be windowed — jsdom has no `OffscreenCanvas`, so without this every
 * figure would take the fallback path and the tests would pass vacuously. The
 * fallback is asserted separately, at the bottom, as the control.
 */
vi.mock('../../simulator/useSimulatorRuntime', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../simulator/useSimulatorRuntime')>()),
  webglRenderSupported: () => true,
}));

const projector = vi.hoisted(() => ({ calls: 0 }));

/**
 * Counted at the module boundary rather than at `reproject3dFigureAt`, because
 * the cost R6 is about is the projection itself — `earcut` over every cell ring,
 * a BSP build, a software rasteriser — and a caller that reached it by some other
 * route would still pay it.
 */
vi.mock('./foldedFigure3dProjection', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./foldedFigure3dProjection')>();
  return {
    ...actual,
    projectFolded3dModel: (...args: Parameters<typeof actual.projectFolded3dModel>) => {
      projector.calls += 1;
      return actual.projectFolded3dModel(...args);
    },
  };
});

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '__fixtures__');
const RENDER_MODEL: OristudioCpFolded3dRenderModel = JSON.parse(
  readFileSync(join(FIXTURES, 'box_90.rendermodel.json'), 'utf8')
);

const HANDLE = 71;
const FIGURE_ID = 'folded-1';

const MODEL: OristudioCpFoldedFigureModel = {
  front_color: { red: 255, green: 255, blue: 100 },
  back_color: { red: 60, green: 60, blue: 200 },
  line_color: { red: 0, green: 0, blue: 0 },
  scale: 1,
  rotation: 0,
  anti_alias: true,
  display_shadows: false,
  state: 'Front0',
  folded_cases: 1,
  transparent_transparency: 16,
  transparency_color: false,
};

const FOLDED_3D = {
  model: MODEL,
  diagnostics: {
    tolerances: {
      angle_radians: 1e-7,
      distance_relative: 1e-6,
      flat_snap_degrees: 1e-6,
      overlap_area_relative: 1e-9,
    },
  },
} as unknown as OristudioCpFolded3dSnapshot;

const CAMERA = defaultFolded3dCamera(RENDER_MODEL, MODEL.state);

function figure(): OristudioCpFoldedFigureEntry {
  return {
    id: FIGURE_ID,
    title: 'Folded model 1',
    handle: HANDLE,
    sourceKind: 'generated-from-current-cp',
    sourceCpRevision: 1,
    startingFaceId: 1,
    displayStyle: 'Paper5',
    status: 'ready',
    snapshot: null,
    folded3d: FOLDED_3D,
    renderSnapshot: project3dRenderSnapshot(RENDER_MODEL, FOLDED_3D, 'Paper5', CAMERA),
    placement: { offset: { x: 0, y: 0 }, scale: 1, rotation: 0 },
    camera: CAMERA,
    frameRadius: folded3dFrameRadius(RENDER_MODEL),
    error: null,
  };
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;

beforeEach(() => {
  vi.useFakeTimers();
  clearAllFolded3dOrbits();
  resetFolded3dRenderModels();
  setFolded3dRenderModel(HANDLE, RENDER_MODEL);
  useWorkspaceStore.setState({
    oristudioCpFoldedFigures: [figure()],
    oristudioCpActiveFoldedFigureId: FIGURE_ID,
    oristudioCpFocusedFoldedFigureId: FIGURE_ID,
  });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  // Building the fixture above projects once, which is the export picture a
  // reopened figure would have been saved with. The count starts here.
  projector.calls = 0;
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  clearAllFolded3dOrbits();
  resetFolded3dRenderModels();
  useWorkspaceStore.setState({
    oristudioCpFoldedFigures: [],
    oristudioCpActiveFoldedFigureId: null,
    oristudioCpFocusedFoldedFigureId: null,
  });
  vi.useRealTimers();
});

type FoldedApi = ReturnType<typeof useFoldedFigures>;

function FoldedProbe({ onRender }: { onRender: (api: FoldedApi) => void }): null {
  onRender(useFoldedFigures({ cpDocument: null, selectedFoldLineIds: [] }));
  return null;
}

function mountFolded(): FoldedApi[] {
  const renders: FoldedApi[] = [];
  act(() => {
    root?.render(<FoldedProbe onRender={(api) => renders.push(api)} />);
  });
  return renders;
}

function latest(renders: FoldedApi[]): FoldedApi {
  const api = renders.at(-1);
  if (!api) throw new Error('expected a render');
  return api;
}

function storedFigure(): OristudioCpFoldedFigureEntry {
  const entry = useWorkspaceStore.getState().oristudioCpFoldedFigures[0];
  if (!entry) throw new Error('expected a figure');
  return entry;
}

describe('a windowed 3D figure never projects at pointer rate', () => {
  it('turns through twenty moves without one projection', () => {
    const api = latest(mountFolded());

    act(() => {
      expect(api.orbit.begin({ x: 0, y: 0 })).toBe(true);
      for (let step = 1; step <= 20; step += 1) {
        api.orbit.advance({ x: step * 3, y: step * 2 });
      }
    });

    // The figure really did turn — otherwise this passes for a drag that moved
    // nothing, which is the way a test like this goes quietly wrong.
    expect(getFolded3dOrbit(FIGURE_ID)?.camera.yaw).not.toBe(CAMERA.yaw);
    expect(projector.calls).toBe(0);
  });

  it('zooms through a burst, and its settle, without one projection', () => {
    const api = latest(mountFolded());

    act(() => {
      for (let step = 0; step < 8; step += 1) api.orbit.zoom(-40);
    });
    expect(getFolded3dOrbit(FIGURE_ID)?.camera.zoom).toBeGreaterThan(CAMERA.zoom);

    act(() => {
      vi.advanceTimersByTime(1_000);
    });

    // The settle writes the store, so this is not "nothing happened": the zoom
    // is on the entry and the picture it was already drawing is kept, because a
    // projection is fitted to the figure's frame at any zoom.
    expect(storedFigure().camera?.zoom).toBeGreaterThan(CAMERA.zoom);
    expect(projector.calls).toBe(0);
  });
});

describe('the exportable picture is still rebuilt, once, when it goes stale', () => {
  it('projects exactly once for a whole turn, on release', () => {
    const api = latest(mountFolded());
    const before = storedFigure().renderSnapshot;

    act(() => {
      api.orbit.begin({ x: 0, y: 0 });
      for (let step = 1; step <= 20; step += 1) {
        api.orbit.advance({ x: step * 3, y: step * 2 });
      }
    });
    const live = getFolded3dOrbit(FIGURE_ID);

    act(() => api.orbit.commit());

    expect(projector.calls).toBe(1);
    // And it is the picture of where the drag ended, not of where it started —
    // this is what an `.osf`, a crease-pattern export and a standalone SVG all
    // read, and a figure that stopped refreshing it would export the old view.
    const after = storedFigure().renderSnapshot;
    expect(after).not.toBe(before);
    expect(after).toEqual(
      reproject3dFigureAt(storedFigure(), 'Paper5', live?.camera ?? CAMERA)
    );
  });
});

describe('a figure that cannot be windowed keeps the projector on the live path', () => {
  it('projects every move, which is what the window is being spared', () => {
    // No frame, so `canWindowFolded3dFigure` refuses it and the crease-pattern
    // scene draws it: the picture *is* the live path, and it has to be rebuilt
    // per move. This is the control — without it the assertions above would hold
    // just as well for an orbit that had stopped working.
    useWorkspaceStore.setState({
      oristudioCpFoldedFigures: [{ ...figure(), frameRadius: null }],
    });
    projector.calls = 0;
    const api = latest(mountFolded());

    act(() => {
      api.orbit.begin({ x: 0, y: 0 });
      for (let step = 1; step <= 5; step += 1) {
        api.orbit.advance({ x: step * 3, y: step * 2 });
      }
    });

    expect(projector.calls).toBe(5);
    expect(getFolded3dOrbit(FIGURE_ID)?.snapshot).not.toBeNull();
  });
});
