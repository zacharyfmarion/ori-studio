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
import { SIMULATOR_MAX_ZOOM, SIMULATOR_MIN_ZOOM } from '../../lib/simulatorOrbit';
import { foldedFigureBox } from '../adapters/cpFoldedToScene';
import { defaultFolded3dCamera, folded3dFrameRadius } from './foldedFigure3dProjection';
import { folded3dWindowView } from './folded3dWindow';
import { project3dRenderSnapshot } from './folded3dReproject';
import { setFolded3dRenderModel, resetFolded3dRenderModels } from './folded3dRenderModels';
import { clearAllFolded3dOrbits, folded3dOrbitCount, getFolded3dOrbit } from './folded3dRuntime';
import { useFoldedFigures } from './useFoldedFigures';

/**
 * Zooming a 3D folded figure: the wheel, and the two scales it must not confuse.
 *
 * A figure's zoom makes the model bigger **inside a window whose size does not
 * change** — the split an inline simulation already has between its wheel and
 * its resize handles. The failure this pins is the other reading, where zoom
 * feeds the frame radius: then a zoom is a resize, the window grows off the
 * canvas, and the two affordances collapse into one.
 *
 * The rest is the orbit's rule applied to a gesture with no release: a wheel
 * burst is transport, so it goes to the side table, and the document is written
 * once when the wheel goes quiet.
 *
 * WebGL is reported as available because a figure can only be zoomed when it is
 * drawn as a live window — jsdom has no `OffscreenCanvas`, so without this the
 * gesture would decline every event and the tests would pass vacuously.
 */
vi.mock('../../simulator/useSimulatorRuntime', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../simulator/useSimulatorRuntime')>()),
  webglRenderSupported: () => true,
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '__fixtures__');
const RENDER_MODEL: OristudioCpFolded3dRenderModel = JSON.parse(
  readFileSync(join(FIXTURES, 'hinge_90.rendermodel.json'), 'utf8'),
);

const HANDLE = 31;
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

/** Inside the figure's box, which is centred on the placement offset. */
const INSIDE = { x: 0, y: 0 };
/** Far outside any figure at this scale. */
const OUTSIDE = { x: 10_000, y: 10_000 };

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

describe('the wheel over a focused 3D folded figure', () => {
  it('is claimed inside the figure and left alone outside it', () => {
    const renders = mountFolded();
    expect(latest(renders).orbit.claimsWheel(INSIDE)).toBe(true);
    expect(latest(renders).orbit.claimsWheel(OUTSIDE)).toBe(false);
  });

  it('is left alone when nothing is focused, so the canvas keeps its zoom', () => {
    act(() => {
      useWorkspaceStore.setState({ oristudioCpFocusedFoldedFigureId: null });
    });
    const renders = mountFolded();
    expect(latest(renders).orbit.claimsWheel(INSIDE)).toBe(false);
  });

  it('is left alone for a figure that is not drawn as a window', () => {
    // A figure reopened from a file has no render model, so its picture cannot
    // be re-drawn at a new zoom at all. Claiming the wheel there would leave the
    // user scrolling over a figure that neither zoomed nor panned the canvas.
    resetFolded3dRenderModels();
    const renders = mountFolded();
    expect(latest(renders).orbit.claimsWheel(INSIDE)).toBe(false);
  });
});

describe('a zoom burst is not a document edit', () => {
  it('publishes every notch to the side table and writes the store none of them', () => {
    const renders = mountFolded();
    const api = latest(renders);
    const figuresBefore = useWorkspaceStore.getState().oristudioCpFoldedFigures;
    const rendersBefore = renders.length;

    act(() => {
      for (let step = 0; step < 8; step += 1) api.orbit.zoom(-40);
    });

    expect(getFolded3dOrbit(FIGURE_ID)?.camera.zoom).toBeGreaterThan(CAMERA.zoom);
    // No picture: only a windowed figure can be zoomed, and a window draws from
    // the camera alone.
    expect(getFolded3dOrbit(FIGURE_ID)?.snapshot).toBeNull();
    expect(useWorkspaceStore.getState().oristudioCpFoldedFigures).toBe(figuresBefore);
    expect(renders.length).toBe(rendersBefore);
  });

  it('writes the store once, when the wheel goes quiet', () => {
    const renders = mountFolded();
    const api = latest(renders);
    const figuresBefore = useWorkspaceStore.getState().oristudioCpFoldedFigures;

    act(() => {
      api.orbit.zoom(-40);
      api.orbit.zoom(-40);
    });
    const live = getFolded3dOrbit(FIGURE_ID);
    expect(useWorkspaceStore.getState().oristudioCpFoldedFigures).toBe(figuresBefore);

    act(() => {
      vi.advanceTimersByTime(1_000);
    });

    expect(useWorkspaceStore.getState().oristudioCpFoldedFigures).not.toBe(figuresBefore);
    expect(storedFigure().camera?.zoom).toBe(live?.camera.zoom);
    expect(folded3dOrbitCount()).toBe(0);
  });

  it('keeps the picture it had, because the projection ignores zoom', () => {
    // The projection is drawn unclipped — in the crease-pattern scene, and in an
    // SVG export — so it draws the model fitted to its frame at any zoom. Redoing
    // it for a zoom would be `earcut` plus a BSP build to arrive at the picture
    // already on the entry.
    const renders = mountFolded();
    const api = latest(renders);
    const pictureBefore = storedFigure().renderSnapshot;

    act(() => {
      api.orbit.zoom(-40);
      vi.advanceTimersByTime(1_000);
    });

    expect(storedFigure().renderSnapshot).toBe(pictureBefore);
    expect(storedFigure().camera?.zoom).not.toBe(CAMERA.zoom);
  });

  it('stops at the same limits the simulator viewport stops at', () => {
    const renders = mountFolded();
    const api = latest(renders);

    act(() => {
      for (let step = 0; step < 200; step += 1) api.orbit.zoom(-40);
    });
    expect(getFolded3dOrbit(FIGURE_ID)?.camera.zoom).toBe(SIMULATOR_MAX_ZOOM);

    act(() => {
      for (let step = 0; step < 400; step += 1) api.orbit.zoom(40);
    });
    expect(getFolded3dOrbit(FIGURE_ID)?.camera.zoom).toBe(SIMULATOR_MIN_ZOOM);
  });
});

describe('a zoom is not a resize', () => {
  it('leaves the window exactly the size it was', () => {
    // The whole point of the two scales staying apart. If zoom fed the frame
    // radius, this box would grow with every notch and the canvas handles and
    // the wheel would be two names for one thing.
    const renders = mountFolded();
    const api = latest(renders);
    const boxBefore = foldedFigureBox(storedFigure());

    act(() => {
      api.orbit.zoom(-40);
      vi.advanceTimersByTime(1_000);
    });

    const zoomed = storedFigure();
    expect(zoomed.camera?.zoom).toBeGreaterThan(CAMERA.zoom);
    expect(zoomed.frameRadius).toBe(figure().frameRadius);
    expect(foldedFigureBox(zoomed)).toEqual(boxBefore);
  });

  it('carries the zoom into the mesh camera, which is what actually grows', () => {
    // Non-vacuity for the test above: the zoom does reach something.
    const renders = mountFolded();
    const api = latest(renders);

    act(() => {
      api.orbit.zoom(-40);
      vi.advanceTimersByTime(1_000);
    });

    const stored = storedFigure().camera;
    expect(folded3dWindowView(stored).zoom).toBe(stored?.zoom);
    expect(folded3dWindowView(stored).zoom).toBeGreaterThan(1);
  });
});
