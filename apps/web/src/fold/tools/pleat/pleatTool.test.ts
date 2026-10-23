import { FOLD_LINE_MODES } from '../foldToolCatalog';
import { describe, expect, it } from 'vitest';
import { activeFoldLineMode, createFoldTools, isLocated, FOLD_EVERY_LAYER } from '../foldToolState';
import { foldPickIndex, type FoldPick } from '../../canvas/foldPicking';
import {
  flatSquareScene,
  flatSquareLandmarks,
} from '../../canvas/foldCanvas.fixtures';
import { buildPleatStep } from './pleatStep';
import { lineSectionProbe } from '../topFlapSeed';
import {
  foldFreeLineStart,
  foldLocatedLines,
} from '../../canvas/foldCanvasModel';
const free = (x: number, y: number): FoldPick => ({
  kind: 'free',
  pane: 'folded',
  sheet: [x, y],
  scene: { x, y },
});
describe('Pleat authoring', () => {
  it('starts with two free lines, preserves the first when switching the second, and locates after four clicks', () => {
    const tools = createFoldTools();
    tools.selectTool('pleat');
    expect(tools.store.getState()).toMatchObject({
      lineMode: 'free',
      secondLineMode: 'free',
    });
    tools.pick(free(0, 0.6));
    tools.pick(free(1, 0.6));
    expect(isLocated(tools.store.getState())).toBe(false);
    tools.pick(free(0, 0.5));
    expect(foldFreeLineStart(tools.store.getState())).toEqual(free(0, 0.5));
    tools.setSecondLineMode('crease');
    expect(tools.store.getState().picks).toHaveLength(2);
    tools.setSecondLineMode('free');
    tools.pick(free(0, 0.5));
    tools.pick(free(1, 0.5));
    expect(isLocated(tools.store.getState())).toBe(true);
    const lines = {
      first: [
        { x: 0, y: 0.6 },
        { x: 1, y: 0.6 },
      ] as [{ x: number; y: number }, { x: number; y: number }],
      second: null,
    };
    expect(foldLocatedLines('pleat', false, lines)).not.toHaveLength(0);
  });
  it('defaults the moving side toward the valley line, with the same side in the layer picker', () => {
    const tools = createFoldTools();
    tools.selectTool('pleat');
    for (const p of [free(0, 0.6), free(1, 0.6), free(0, 0.5), free(1, 0.5)])
      tools.pick(p);
    const index = foldPickIndex(flatSquareScene(), flatSquareLandmarks(), []);
    const state = tools.store.getState();
    const build = buildPleatStep(
      { ...state, seed: FOLD_EVERY_LAYER, candidate: null },
      index,
    );
    expect(build.status).toBe('built');
    if (build.status !== 'built') return;
    expect(build.movingSign).toBe(-1);
    expect(build.op.kind).toBe('pleat');
    expect(lineSectionProbe(state, index, null)?.side).toBe('negative');
    tools.swapSide();
    const opposite = buildPleatStep(
      { ...tools.store.getState(), seed: FOLD_EVERY_LAYER, candidate: null },
      index,
    );
    expect(opposite.status === 'built' && opposite.movingSign).toBe(1);
  });
});

it.each(FOLD_LINE_MODES)('changes only the active valley construction to %s', (mode) => {
  const tools = createFoldTools();
  tools.selectTool('pleat');
  tools.selectLineMode('axiom-3');
  tools.pick(free(0, 0.6)); tools.pick(free(1, 0.6));
  tools.stepRoot(1, 2);
  const mountain = tools.store.getState();
  tools.pick(free(0.2, 0.5));
  tools.selectLineMode(mode);
  const state = tools.store.getState();
  expect(state.lineMode).toBe('axiom-3');
  expect(state.root).toBe(1);
  expect(state.picks.slice(0, 2)).toEqual(mountain.picks);
  expect(activeFoldLineMode(state)).toBe(mode);
  expect(state.secondLineMode).toBe(mode);
  if (mode !== 'free') expect(state.picks).toHaveLength(2);
  tools.stepRoot(1, 3, 'second');
  expect(tools.store.getState().root).toBe(1);
  expect(tools.store.getState().secondRoot).toBe(1);
  // An explicit edit of the first field really does restart that construction.
  tools.selectLineMode('axiom-2', 'first');
  expect(tools.store.getState().picks).toHaveLength(0);
  expect(activeFoldLineMode(tools.store.getState())).toBe('axiom-2');
});
