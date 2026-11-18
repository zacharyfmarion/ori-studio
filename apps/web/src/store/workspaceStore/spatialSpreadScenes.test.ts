import { createStore } from 'zustand';
import { afterEach, expect, it, vi } from 'vitest';
import type { WorkspaceState } from './types';
import type { OristudioCpFoldedFigureEntry } from '../../engine/oristudioCpTypes';
import { installSpatialSpreadScenes } from './spatialSpreadScenes';
import { useFoldedFigureSpreadStatusStore } from '../../cp-workspace/folded/foldedFigureSpreadStatus';
const pending = vi.hoisted(
  () =>
    [] as {
      figure: OristudioCpFoldedFigureEntry;
      signal: AbortSignal;
      resolve: (f: OristudioCpFoldedFigureEntry) => void;
    }[]
);
vi.mock('../../cp-workspace/folded/settledSpatialFigures', () => ({
  settledSpatialFigure: (
    figure: OristudioCpFoldedFigureEntry,
    signal: AbortSignal
  ) => new Promise((resolve) => pending.push({ figure, signal, resolve })),
}));
vi.mock('../../cp-workspace/folded/folded3dRenderModels', () => ({
  folded3dRenderModel: () => null,
}));
vi.mock('../../cp-workspace/folded/folded3dAuxLines', () => ({
  folded3dAuxLinesOf: () => null,
}));
afterEach(() => {
  vi.useRealTimers();
  pending.length = 0;
  useFoldedFigureSpreadStatusStore.setState({ byFigure: {} });
});
it('settles unwindowed figures and discards the old capture after an undo or recipe change', async () => {
  vi.useFakeTimers();
  const figure = {
    id: 'one',
    handle: 1,
    folded3d: {},
    displayStyle: 'Paper5',
    spread: { kind: 'spatial', version: 1, amount: 1 },
    scene: null,
  } as OristudioCpFoldedFigureEntry;
  const store = createStore<WorkspaceState>(
    () => ({ oristudioCpFoldedFigures: [figure] }) as WorkspaceState
  );
  const uninstall = installSpatialSpreadScenes(store);
  await vi.advanceTimersByTimeAsync(180);
  expect(pending).toHaveLength(1);
  const next = {
    ...figure,
    spread: { kind: 'spatial', version: 1, amount: 2 } as const,
  };
  store.setState({ oristudioCpFoldedFigures: [next] });
  await vi.advanceTimersByTimeAsync(180);
  expect(pending[0]!.signal.aborted).toBe(true);
  pending[0]!.resolve({
    ...figure,
    scene: {
      sheet: 1,
      bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 },
      items: [],
    },
  });
  await Promise.resolve();
  expect(store.getState().oristudioCpFoldedFigures[0]!.scene).toBeNull();
  const scene = {
    sheet: 2,
    bounds: { minX: 0, minY: 0, maxX: 2, maxY: 2 },
    items: [],
  };
  pending[1]!.resolve({ ...next, scene });
  await Promise.resolve();
  expect(store.getState().oristudioCpFoldedFigures[0]!.scene).toBe(scene);
  expect(pending).toHaveLength(2); // publishing a derived picture never starts another capture
  store.setState({ oristudioCpFoldedFigures: [{ ...next, spread: null }] });
  expect(
    useFoldedFigureSpreadStatusStore.getState().byFigure.one
  ).toBeUndefined();
  uninstall();
});
