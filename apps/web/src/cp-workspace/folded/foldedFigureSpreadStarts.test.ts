import { afterEach, describe, expect, it } from 'vitest';
import type { OristudioCpFoldedFigureEntry } from '../../engine/oristudioCpTypes';
import type { LayerSpreadOptions } from './foldedLayerSpread';
import {
  foldedFigureSpreadStarts,
  noteFoldedFigureSpreadSet,
  resetFoldedFigureSpreadRecency,
} from './foldedFigureSpreadStarts';
import { DEFAULT_AFFINE_SPREAD, DEFAULT_CONNECTED_SPREAD, DEFAULT_DEPTH_SPREAD } from './layerSpreadSettings';

function figure(id: string, spread?: LayerSpreadOptions): OristudioCpFoldedFigureEntry {
  return {
    id,
    title: id,
    handle: null,
    sourceKind: 'generated-from-current-cp',
    sourceCpRevision: 1,
    startingFaceId: 1,
    displayStyle: 'Paper5',
    status: 'ready',
    snapshot: null,
    renderSnapshot: null,
    placement: { offset: { x: 0, y: 0 }, scale: 1, rotation: 0 },
    error: null,
    ...(spread ? { spread: { kind: 'record' as const, spread } } : {}),
  };
}

const wide: LayerSpreadOptions = { ...DEFAULT_CONNECTED_SPREAD, amount: 1.4 };
const down: LayerSpreadOptions = { ...DEFAULT_DEPTH_SPREAD, amount: 0.1 };

afterEach(() => resetFoldedFigureSpreadRecency());

describe('what a figure’s spread starts from', () => {
  it('is the default with no other figure spread', () => {
    const starts = foldedFigureSpreadStarts([figure('a'), figure('b', wide)], 'b');
    expect(starts).toEqual({
      any: DEFAULT_CONNECTED_SPREAD,
      connected: DEFAULT_CONNECTED_SPREAD,
      depth: DEFAULT_DEPTH_SPREAD,
      affine: DEFAULT_AFFINE_SPREAD,
    });
  });

  it('is the spread most recently set on another figure, and of a kind, the most recent of it', () => {
    const figures = [figure('a', wide), figure('b', down), figure('c')];
    noteFoldedFigureSpreadSet('b');
    noteFoldedFigureSpreadSet('a');
    expect(foldedFigureSpreadStarts(figures, 'c')).toMatchObject({ any: wide, connected: wide, depth: down });
    noteFoldedFigureSpreadSet('b');
    expect(foldedFigureSpreadStarts(figures, 'c').any).toBe(down);
  });

  it('takes a reopened file’s figures, none set this session, the last folded first', () => {
    const figures = [figure('a', wide), figure('b', down), figure('c')];
    expect(foldedFigureSpreadStarts(figures, 'c').any).toBe(down);
    // A figure set this session comes before them.
    noteFoldedFigureSpreadSet('a');
    expect(foldedFigureSpreadStarts(figures, 'c').any).toBe(wide);
  });

  it('never starts a figure from a newer build’s spread, or from its own', () => {
    const newer = { ...figure('a'), spread: { kind: 'newer' as const, saved: { spread: { kind: 'radial' } } } };
    noteFoldedFigureSpreadSet('a');
    noteFoldedFigureSpreadSet('c');
    expect(foldedFigureSpreadStarts([newer, figure('c', wide)], 'c').any).toEqual(DEFAULT_CONNECTED_SPREAD);
  });
});
