/**
 * Pose's simulated model, headless, for the diagram corpus. Test support:
 * `diagramDataset.test.ts` imports it before the rest of the harness, so its
 * two stand-ins are in place for every module after it. Each replaces a
 * transport, nothing else:
 *
 * - The store's CP runtime answers `exportOristudioCpLinesAsFold` and
 *   `fetchOristudioCpSheetIndex` from the kernel in-process, for the pattern
 *   {@link withStoreKernel} names. So `storeSimulationFold`, the model Pose's
 *   simulated view loads, runs as the app runs it on that commit, through
 *   whatever `ensureCpSheetSimulationArtifacts` is there.
 * - `prepareFoldModel` is the simulator package's own, and the model it last
 *   prepared is kept ({@link lastPreparedModel}): the GPU renderer the live
 *   view draws with is then built on the very model the session prepared,
 *   with the options it chose on that commit.
 */
import { vi } from 'vitest';
import type { PreparedOrigamiModel } from '@treemaker/origami-simulator';

interface RoutedKernel {
  exportFoldLines: (lineIds: number[]) => Promise<string>;
  sheetIndex: () => Promise<unknown>;
}

const routed = vi.hoisted(() => ({ kernel: null as RoutedKernel | null, prepared: null as unknown }));

vi.mock('../../store/workspaceStore/oristudioCpRuntime', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../store/workspaceStore/oristudioCpRuntime')>();
  const { CpSheetIndex } = await import('../../engine/oristudioCpSheetIndex');
  const kernel = (): RoutedKernel => {
    if (!routed.kernel) throw new Error('the store has no crease pattern routed to it (withStoreKernel)');
    return routed.kernel;
  };
  return {
    ...actual,
    exportOristudioCpLinesAsFold: async (lineIds: readonly number[]) => kernel().exportFoldLines([...lineIds]),
    fetchOristudioCpSheetIndex: async () =>
      new CpSheetIndex((await kernel().sheetIndex()) as ConstructorParameters<typeof CpSheetIndex>[0]),
  };
});

vi.mock('@treemaker/origami-simulator', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@treemaker/origami-simulator')>();
  return {
    ...actual,
    prepareFoldModel: (...args: Parameters<typeof actual.prepareFoldModel>) => {
      const prepared = actual.prepareFoldModel(...args);
      routed.prepared = prepared;
      return prepared;
    },
  };
});

/** Runs `work` with the store's CP calls answered from `kernel`, as the app's runtime answers them for its open pattern. */
export async function withStoreKernel<T>(kernel: RoutedKernel, work: () => Promise<T>): Promise<T> {
  routed.kernel = kernel;
  try {
    return await work();
  } finally {
    routed.kernel = null;
  }
}

/** The model `prepareFoldModel` last prepared, or null; cleared as it is read. */
export function lastPreparedModel(): PreparedOrigamiModel | null {
  const prepared = routed.prepared as PreparedOrigamiModel | null;
  routed.prepared = null;
  return prepared;
}
