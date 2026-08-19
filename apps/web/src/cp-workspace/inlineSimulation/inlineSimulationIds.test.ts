import { beforeEach, describe, expect, it } from 'vitest';
import { useWorkspaceStore } from '../../store/workspaceStore';
import {
  nextInlineSimulationId,
  noteInlineSimulationIds,
  resetInlineSimulationIds,
} from './inlineSimulationIds';
import {
  clearAllInlineSimulationSources,
  getInlineSimulationSource,
  setInlineSimulationSource,
} from './inlineSimulationRuntime';
import type { InlineSimulation } from './inlineSimulation';

/**
 * A window as a project file restores it: the id it was saved under, and its own
 * saved box.
 *
 * The sizes below are the ones from the file this was found on — two 800s and a
 * 400. That the hijacked window is the *small* one is what made the bug look
 * like a sizing fault rather than an identity one.
 */
function loadedWindow(id: string, edge: number): InlineSimulation {
  return {
    id,
    box: { center: { x: 1000, y: 1000 }, width: edge, height: edge, rotation: 0 },
    z: 1,
    view: { yaw: 0, pitch: 0, zoom: 1 },
    sourceBoundary: [
      [
        { x: -200, y: -200 },
        { x: 200, y: -200 },
        { x: 200, y: 200 },
      ],
    ],
    sourceBounds: { minX: -200, minY: -200, maxX: 200, maxY: 200 },
    sourceFingerprint: 'cs1:deadbeefdeadbeef',
    segmentIdHint: 0,
  };
}

/** The region a new window is opened on, and artifacts that can fold it. */
const segment = {
  id: 0,
  faceIndices: [0],
  boundary: [
    [
      { x: -200, y: -200 },
      { x: 200, y: -200 },
      { x: 200, y: 200 },
      { x: -200, y: 200 },
    ],
  ],
  bounds: { minX: -200, minY: -200, maxX: 200, maxY: 200 },
};

const artifacts = {
  fold: {
    vertices_coords: [
      [-200, -200],
      [200, -200],
      [200, 200],
      [-200, 200],
    ],
    edges_vertices: [
      [0, 1],
      [1, 2],
      [2, 3],
      [3, 0],
    ],
    edges_assignment: ['B', 'B', 'B', 'B'],
    faces_vertices: [[0, 1, 2, 3]],
  },
  segments: [segment],
} as never;

beforeEach(() => {
  resetInlineSimulationIds();
  clearAllInlineSimulationSources();
  useWorkspaceStore.setState({
    oristudioCpDocument: {
      document: { crease_pattern: { line_segments: [], points: [], circles: [] } },
    } as never,
    foldArtifacts: artifacts,
    oristudioCpInlineSimulations: [],
  });
});

describe('allocating a window id', () => {
  it('starts at one in a fresh session', () => {
    expect(nextInlineSimulationId()).toBe('inline-sim-1');
    expect(nextInlineSimulationId()).toBe('inline-sim-2');
  });

  it('never hands out an id a file restored', () => {
    // The shipped bug: a load put these in the store and the counter, still at
    // 1, handed the next window `inline-sim-1` — an id already in use.
    noteInlineSimulationIds([
      loadedWindow('inline-sim-2', 800),
      loadedWindow('inline-sim-3', 800),
      loadedWindow('inline-sim-1', 400),
    ]);
    expect(nextInlineSimulationId()).toBe('inline-sim-4');
  });

  it('does not reuse the id of a deleted window', () => {
    // Ids stay monotonic because the runtime side table outlives a delete: the
    // window's fold position is kept so undo brings it back where it was, and a
    // reused id would inherit it. Lowest-free-number allocation fails this.
    const first = nextInlineSimulationId();
    const second = nextInlineSimulationId();
    // The second window is deleted, so only the first is live.
    expect(nextInlineSimulationId([loadedWindow(first, 400)])).not.toBe(second);
  });

  it('leaves ids it did not mint alone', () => {
    // A foreign id cannot collide with the scheme, so it moves nothing.
    noteInlineSimulationIds([loadedWindow('window-from-elsewhere', 400)]);
    noteInlineSimulationIds([loadedWindow('inline-sim-1x', 400)]);
    expect(nextInlineSimulationId()).toBe('inline-sim-1');
  });

  it('skips a live id even when nothing noted it', () => {
    // Belt and braces for a future path that writes windows into the store
    // without noting them.
    const id = nextInlineSimulationId([loadedWindow('inline-sim-7', 400)]);
    expect(id).toBe('inline-sim-8');
  });
});

describe('opening a window after a file load', () => {
  /** Seed the store the way loading a project does, ids noted and all. */
  function loadWindows(simulations: InlineSimulation[]): void {
    noteInlineSimulationIds(simulations);
    useWorkspaceStore.setState({ oristudioCpInlineSimulations: simulations });
    for (const simulation of simulations) {
      setInlineSimulationSource(simulation.id, {
        fold: { vertices_coords: [[0, 0]] } as never,
        modelKey: `loaded:${simulation.id}`,
      });
    }
  }

  it('gives the new window an id of its own', async () => {
    loadWindows([
      loadedWindow('inline-sim-1', 400),
      loadedWindow('inline-sim-2', 800),
      loadedWindow('inline-sim-3', 800),
    ]);

    await useWorkspaceStore.getState().addOristudioCpInlineSimulation({ segment, cpLineIds: [] });

    const ids = useWorkspaceStore
      .getState()
      .oristudioCpInlineSimulations.map((simulation) => simulation.id);
    expect(ids).toHaveLength(4);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('leaves the restored windows drawing their own folds', async () => {
    // The visible symptom. A shared id meant the new fold replaced the loaded
    // window's in the runtime table, so a 400-wide window from the file started
    // drawing the simulation that was just created — two copies of one model,
    // both matching `focusedId`, both advancing on play.
    loadWindows([loadedWindow('inline-sim-1', 400)]);

    await useWorkspaceStore.getState().addOristudioCpInlineSimulation({ segment, cpLineIds: [] });

    expect(getInlineSimulationSource('inline-sim-1')?.modelKey).toBe('loaded:inline-sim-1');
  });
});
