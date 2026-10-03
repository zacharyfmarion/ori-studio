import { describe, expect, it, vi } from 'vitest';

const kernel = vi.hoisted(() => {
  const snapshot = { discovered_fold_cases: 2, display_style: 'Paper5', outcome: 'Solved' };
  return {
    foldOristudioCpDocument: vi.fn(async () => ({ handle: 9, snapshot })),
    foldOristudioCpFigureToCase: vi.fn(async () => ({ snapshot })),
    foldOristudioCpFigureAnother: vi.fn(async () => ({ ...snapshot, outcome: 'NoSolutions' })),
    setOristudioCpFoldedFigureModel: vi.fn(async () => snapshot),
    getOristudioCpFoldedFigureRenderSnapshot: vi.fn(async () => null),
    getOristudioCpFoldedFigurePaperScene: vi.fn(async () => null),
    freeOristudioCpFoldedFigure: vi.fn(async () => {}),
  };
});
vi.mock('./oristudioCpRuntime', () => kernel);

import { createCpFoldRuntime } from './cpFoldRuntimeBindings';

describe('createCpFoldRuntime', () => {
  it('binds every fold call to its run, so a Stop aimed at the run reaches each', async () => {
    const runtime = createCpFoldRuntime(42);
    await runtime.fold(1, 'Order5', undefined, [3, 4]);
    await runtime.foldToCase(9, 2);
    await runtime.foldAnother(9);
    expect(kernel.foldOristudioCpDocument).toHaveBeenCalledWith(1, 'Order5', undefined, [3, 4], 42);
    expect(kernel.foldOristudioCpFigureToCase).toHaveBeenCalledWith(9, 2, 'Order5', 42);
    expect(kernel.foldOristudioCpFigureAnother).toHaveBeenCalledWith(9, 42);
  });

  it('reports what each fold left the figure in, outcome included', async () => {
    const runtime = createCpFoldRuntime(0);
    expect(await runtime.fold(1, 'Order5', undefined, [3])).toEqual({
      handle: 9,
      discoveredCases: 2,
      displayStyle: 'Paper5',
      outcome: 'Solved',
    });
    expect((await runtime.foldAnother(9)).outcome).toBe('NoSolutions');
    expect(await runtime.setModel(9, {} as never)).toMatchObject({ displayStyle: 'Paper5' });
  });
});
