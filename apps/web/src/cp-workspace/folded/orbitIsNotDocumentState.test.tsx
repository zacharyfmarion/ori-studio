import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useWorkspaceStore } from '../../store/workspaceStore';
import type {
  OristudioCpFolded3dRenderModel,
  OristudioCpFolded3dSnapshot,
  OristudioCpFoldedFigureEntry,
  OristudioCpFoldedFigureModel,
} from '../../engine/oristudioCpTypes';
import { defaultFolded3dCamera, folded3dFrameRadius } from './foldedFigure3dProjection';
import { project3dRenderSnapshot } from './folded3dReproject';
import { setFolded3dRenderModel, resetFolded3dRenderModels } from './folded3dRenderModels';
import {
  clearAllFolded3dOrbits,
  folded3dOrbitCount,
  getFolded3dOrbit,
  publishFolded3dOrbit,
} from './folded3dRuntime';
import { useFoldedFigures } from './useFoldedFigures';
import { useFolded3dOrbitFigures } from './useFolded3dOrbitFigures';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '__fixtures__');
const RENDER_MODEL: OristudioCpFolded3dRenderModel = JSON.parse(
  readFileSync(join(FIXTURES, 'hinge_90.rendermodel.json'), 'utf8')
);

const HANDLE = 11;
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

/**
 * Only `model` and `diagnostics.tolerances` are read when a figure is
 * re-projected, so the rest of the ~2 KB kernel snapshot is left out rather than
 * transcribed — the same shape the other folded-figure tests use.
 */
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
    frameRadius: folded3dFrameRadius(RENDER_MODEL, CAMERA),
    error: null,
  };
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;

beforeEach(() => {
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
});

type FoldedApi = ReturnType<typeof useFoldedFigures>;

/**
 * Mounts the binding layer and reports every render pass. `onRender` is called
 * *during* render on purpose: the thing being measured is how many times React
 * re-rendered the surface, and an effect would only run when it already had.
 */
function FoldedProbe({ onRender }: { onRender: (api: FoldedApi) => void }): null {
  onRender(useFoldedFigures({ cpDocument: null, selectedFoldLineIds: [] }));
  return null;
}

function mountFolded(): { renders: FoldedApi[] } {
  const renders: FoldedApi[] = [];
  act(() => {
    root?.render(<FoldedProbe onRender={(api) => renders.push(api)} />);
  });
  return { renders };
}

/**
 * An orbit frame must not reach anything derived from the document.
 *
 * `setOristudioCpFolded3dCamera` used to be called on every pointermove, and
 * each call produced a new `oristudioCpFoldedFigures` array — which invalidates
 * `staleFoldedFigureIds` (a reselect and fingerprint over every crease in the
 * source region, per frame), `foldedFigureObjects`, `canvasObjects`, and
 * re-renders the crease-pattern panel. This is the same failure
 * `inlineSimulation/foldIsNotDocumentState.test.ts` pins for a running fold, and
 * it is asserted on array identity rather than on one field for the same reason:
 * it fails for *any* per-frame value put back into document-shaped state.
 */
describe('an orbit frame is not a document edit', () => {
  it('leaves the figures array — and everything memoized on it — untouched', () => {
    const { renders } = mountFolded();
    const api = renders.at(-1);
    if (!api) throw new Error('expected a render');

    const figuresBefore = useWorkspaceStore.getState().oristudioCpFoldedFigures;
    const rendersBefore = renders.length;

    act(() => {
      expect(api.orbit.begin({ x: 100, y: 100 })).toBe(true);
      for (let step = 1; step <= 20; step += 1) {
        api.orbit.advance({ x: 100 + step * 3, y: 100 + step * 2 });
      }
    });

    expect(useWorkspaceStore.getState().oristudioCpFoldedFigures).toBe(figuresBefore);
    // No store write means no re-render, so the derived memos cannot even have
    // been re-evaluated. Asserted as a render count because that is the cost
    // being avoided; the identity checks below say the same thing about the
    // values a re-render would have thrown away.
    expect(renders.length).toBe(rendersBefore);
    expect(renders.at(-1)?.transformableObjects).toBe(api.transformableObjects);
    expect(renders.at(-1)?.staleIds).toBe(api.staleIds);
  });

  it('still turns the figure — the live camera and picture change every move', () => {
    // Without this the test above would pass just as well for an orbit that did
    // nothing at all.
    const { renders } = mountFolded();
    const api = renders.at(-1);
    if (!api) throw new Error('expected a render');
    const storedSnapshot = useWorkspaceStore.getState().oristudioCpFoldedFigures[0]?.renderSnapshot;

    act(() => {
      api.orbit.begin({ x: 100, y: 100 });
      api.orbit.advance({ x: 130, y: 120 });
    });

    const first = getFolded3dOrbit(FIGURE_ID);
    expect(first?.camera.yaw).toBeCloseTo(CAMERA.yaw - 30 * 0.01, 12);
    expect(first?.camera.pitch).toBeCloseTo(CAMERA.pitch + 20 * 0.01, 12);
    expect(first?.snapshot).not.toBeNull();
    expect(first?.snapshot).not.toEqual(storedSnapshot);

    act(() => api.orbit.advance({ x: 160, y: 140 }));
    const second = getFolded3dOrbit(FIGURE_ID);
    expect(second?.camera.yaw).not.toBe(first?.camera.yaw);
    expect(second?.snapshot).not.toEqual(first?.snapshot);
  });

  it('writes the store once, on release, and drops the live frame', () => {
    const { renders } = mountFolded();
    const api = renders.at(-1);
    if (!api) throw new Error('expected a render');
    const figuresBefore = useWorkspaceStore.getState().oristudioCpFoldedFigures;

    act(() => {
      api.orbit.begin({ x: 100, y: 100 });
      api.orbit.advance({ x: 130, y: 120 });
      api.orbit.advance({ x: 160, y: 140 });
    });
    const live = getFolded3dOrbit(FIGURE_ID);

    act(() => api.orbit.commit());

    const figuresAfter = useWorkspaceStore.getState().oristudioCpFoldedFigures;
    expect(figuresAfter).not.toBe(figuresBefore);
    expect(figuresAfter[0]?.camera).toEqual(live?.camera);
    expect(figuresAfter[0]?.renderSnapshot).toEqual(live?.snapshot);
    expect(folded3dOrbitCount()).toBe(0);
  });

  it('writes nothing for a press that never turned anything', () => {
    const { renders } = mountFolded();
    const api = renders.at(-1);
    if (!api) throw new Error('expected a render');
    const figuresBefore = useWorkspaceStore.getState().oristudioCpFoldedFigures;

    act(() => {
      api.orbit.begin({ x: 100, y: 100 });
      // The pointer never left the press: `advanceFoldedFigureOrbit` returns the
      // anchor exactly, so this is a click and not a turn.
      api.orbit.advance({ x: 100, y: 100 });
      api.orbit.commit();
    });

    expect(useWorkspaceStore.getState().oristudioCpFoldedFigures).toBe(figuresBefore);
    expect(folded3dOrbitCount()).toBe(0);
  });
});

/**
 * The other half: the frame the panel does not see still has to reach the thing
 * that draws it.
 */
describe('the drawing path sees the live frame', () => {
  function OrbitProbe({
    figures,
    onRender,
  }: {
    figures: readonly OristudioCpFoldedFigureEntry[];
    onRender: (drawn: readonly OristudioCpFoldedFigureEntry[]) => void;
  }): null {
    onRender(useFolded3dOrbitFigures(figures));
    return null;
  }

  it('swaps in the orbiting figure’s camera and picture, and nothing else', () => {
    const stored = figure();
    const other: OristudioCpFoldedFigureEntry = { ...stored, id: 'folded-2' };
    const figures = [stored, other];
    const drawn: Array<readonly OristudioCpFoldedFigureEntry[]> = [];
    act(() => {
      root?.render(<OrbitProbe figures={figures} onRender={(next) => drawn.push(next)} />);
    });

    // Nothing live: the same array, so the geometry memo downstream is not
    // invalidated by a subscription that fired for some other figure.
    expect(drawn.at(-1)).toBe(figures);

    const { renders } = mountFoldedInto(figures);
    const api = renders.at(-1);
    if (!api) throw new Error('expected a render');
    act(() => {
      api.orbit.begin({ x: 100, y: 100 });
      api.orbit.advance({ x: 130, y: 120 });
    });

    const latest = drawn.at(-1);
    expect(latest).not.toBe(figures);
    expect(latest?.[0]?.camera).toEqual(getFolded3dOrbit(FIGURE_ID)?.camera);
    expect(latest?.[0]?.renderSnapshot).toBe(getFolded3dOrbit(FIGURE_ID)?.snapshot);
    // The figure nobody is turning is passed through by identity.
    expect(latest?.[1]).toBe(other);
  });

  it('is not woken at all by a figure drawn as a window', () => {
    // A windowed figure publishes a camera and no picture, because its mesh is
    // drawn from the camera alone. The crease-pattern canvas subscribes here,
    // and it draws pictures — so none of those frames may reach it. Sixty
    // re-renders a second of the largest component in the app, to deliver
    // something it had already decided not to draw.
    const figures = [figure()];
    const drawn: Array<readonly OristudioCpFoldedFigureEntry[]> = [];
    act(() => {
      root?.render(<OrbitProbe figures={figures} onRender={(next) => drawn.push(next)} />);
    });
    const renders = drawn.length;

    act(() => {
      for (let step = 1; step <= 10; step += 1) {
        publishFolded3dOrbit(FIGURE_ID, {
          camera: { ...CAMERA, yaw: CAMERA.yaw + step * 0.01 },
          snapshot: null,
        });
      }
    });

    expect(drawn.length).toBe(renders);
    expect(drawn.at(-1)).toBe(figures);

    // Non-vacuous: one frame that *does* carry a picture goes through.
    act(() => {
      publishFolded3dOrbit(FIGURE_ID, { camera: CAMERA, snapshot: figure().renderSnapshot });
    });
    expect(drawn.length).toBeGreaterThan(renders);
    expect(drawn.at(-1)).not.toBe(figures);
  });

  /**
   * A second root, so the binding layer and the drawing probe are independent
   * React trees — which is the arrangement in the app (the panel holds one, the
   * canvas subscribes on its own) and the only way to show that the frame
   * travels through the side table rather than through props.
   */
  function mountFoldedInto(figures: readonly OristudioCpFoldedFigureEntry[]): {
    renders: FoldedApi[];
  } {
    useWorkspaceStore.setState({ oristudioCpFoldedFigures: [...figures] });
    const host = document.createElement('div');
    document.body.appendChild(host);
    const second = createRoot(host);
    const renders: FoldedApi[] = [];
    act(() => {
      second.render(<FoldedProbe onRender={(api) => renders.push(api)} />);
    });
    secondaryRoots.push({ root: second, host });
    return { renders };
  }

  const secondaryRoots: Array<{ root: Root; host: HTMLDivElement }> = [];

  afterEach(() => {
    for (const entry of secondaryRoots.splice(0)) {
      act(() => entry.root.unmount());
      entry.host.remove();
    }
  });
});
