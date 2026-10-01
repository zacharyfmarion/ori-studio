import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createStore, type StoreApi } from 'zustand/vanilla';
import type { CpGeometryTransport } from '../../engine/oristudioCpGeometry';
import { SEG_ATTR_STRIDE } from '../../engine/oristudioCpGeometry';
import {
  folded3dAuxKeyOf,
  folded3dAuxLinesOf,
  resetFolded3dAuxLines,
} from '../../cp-workspace/folded/folded3dAuxLines';
import {
  resetFoldedFigureHandles,
  retainFoldedFigureHandle,
} from '../../cp-workspace/folded/foldedFigureHandles';
import {
  folded3dAuxLinesSettled,
  installFolded3dAuxLinesSync,
  resetFolded3dAuxLinesSync,
} from './folded3dAuxLinesSync';
import type { WorkspaceState } from './types';

const asks = vi.hoisted(() => ({
  calls: [] as Array<[number, number]>,
  answer: { faces: [0], points: [0, 0, 0, 1, 0, 0] },
}));
vi.mock('./oristudioCpRuntime', () => ({
  getOristudioCpFolded3dAuxLines: async (handle: number, documentHandle: number) => {
    asks.calls.push([handle, documentHandle]);
    return asks.answer;
  },
}));

/** A transport of `[x1, y1, x2, y2, colour]` segments. */
function geometry(segments: [number, number, number, number, number][]): CpGeometryTransport {
  const segAttr = new Int32Array(segments.length * SEG_ATTR_STRIDE);
  segments.forEach((segment, i) => {
    segAttr[i * SEG_ATTR_STRIDE] = segment[4];
  });
  return {
    segEndpoints: Float64Array.from(segments.flatMap((segment) => segment.slice(0, 4))),
    segAttr,
  } as unknown as CpGeometryTransport;
}

const PATTERN: [number, number, number, number, number][] = [[0, 0, 1, 1, 1]];

type Slice = Pick<
  WorkspaceState,
  'oristudioCpDocument' | 'oristudioCpFoldedFigures' | 'refreshOristudioCpFolded3dScenes'
>;

let store: StoreApi<Slice>;
let uninstall: () => void;
const refresh = vi.fn();

function withAux(...aux: [number, number, number, number][]): Slice['oristudioCpDocument'] {
  return {
    handle: 4,
    geometry: geometry([...PATTERN, ...aux.map((s) => [...s, 3] as [number, number, number, number, number])]),
  } as unknown as Slice['oristudioCpDocument'];
}

async function settle(): Promise<void> {
  for (let i = 0; i < 4; i += 1) await Promise.resolve();
}

beforeEach(async () => {
  asks.calls = [];
  refresh.mockClear();
  resetFolded3dAuxLines();
  resetFolded3dAuxLinesSync();
  await resetFoldedFigureHandles();
  retainFoldedFigureHandle(7);
  store = createStore<Slice>(() => ({
    oristudioCpDocument: withAux(),
    oristudioCpFoldedFigures: [
      { id: 'spatial', handle: 7, folded3d: {} },
      { id: 'flat', handle: 8, folded3d: null },
    ] as unknown as Slice['oristudioCpFoldedFigures'],
    refreshOristudioCpFolded3dScenes: refresh,
  }));
  uninstall = installFolded3dAuxLinesSync(store as unknown as StoreApi<WorkspaceState>);
});

afterEach(() => {
  uninstall();
});

describe('installFolded3dAuxLinesSync', () => {
  it('asks nothing of a document with no aux lines, and redraws nothing', async () => {
    await settle();
    expect(asks.calls).toEqual([]);
    expect(folded3dAuxLinesOf(7)).toEqual({ faces: [], points: [] });
    expect(refresh).not.toHaveBeenCalled();
    // A flat figure is not this store's.
    expect(folded3dAuxKeyOf(8)).toBeUndefined();
  });

  it('asks again when the document’s aux lines change, and rebuilds the pictures', async () => {
    store.setState({ oristudioCpDocument: withAux([0, 0.5, 1, 0.5]) });
    await settle();
    expect(asks.calls).toEqual([[7, 4]]);
    expect(folded3dAuxLinesOf(7)).toBe(asks.answer);
    expect(refresh).toHaveBeenCalledTimes(1);

    // Any other edit leaves the aux lines where they were.
    store.setState({ oristudioCpDocument: withAux([0, 0.5, 1, 0.5]) });
    await settle();
    expect(asks.calls).toHaveLength(1);

    // Erasing the last aux line takes them off the figure without asking.
    store.setState({ oristudioCpDocument: withAux() });
    await settle();
    expect(asks.calls).toHaveLength(1);
    expect(folded3dAuxLinesOf(7)).toEqual({ faces: [], points: [] });
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it('lets an export wait for the lines a moment-old edit drew', async () => {
    store.setState({ oristudioCpDocument: withAux([0, 0.25, 1, 0.25]) });
    await folded3dAuxLinesSettled(store as unknown as StoreApi<WorkspaceState>, 7);
    expect(folded3dAuxLinesOf(7)).toBe(asks.answer);
  });
});
