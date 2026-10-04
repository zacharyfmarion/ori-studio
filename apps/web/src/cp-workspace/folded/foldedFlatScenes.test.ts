import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  OristudioCpFoldedFigureSnapshot,
  OristudioCpFoldedPaperScene,
} from '../../engine/oristudioCpTypes';
import {
  releaseFoldedFigureHandle,
  resetFoldedFigureHandles,
  retainFoldedFigureHandle,
} from './foldedFigureHandles';
import {
  dropFoldedFlatScene,
  foldedFlatScene,
  foldedFlatSceneCount,
  foldedFlatScenes,
  resetFoldedFlatScenes,
  setFoldedFlatScene,
  subscribeFoldedFlatScenes,
} from './foldedFlatScenes';

const scene = (): OristudioCpFoldedPaperScene => ({
  schema_version: 1,
  flipped: false,
  sheet: 1,
  faces: [],
  subfaces: [],
  aux_lines: [],
  sheet_points: [],
});
const snapshot = (): OristudioCpFoldedFigureSnapshot =>
  ({ model: {} }) as OristudioCpFoldedFigureSnapshot;

beforeEach(async () => {
  resetFoldedFlatScenes();
  await resetFoldedFigureHandles();
});

describe('foldedFlatScenes', () => {
  it('answers for the snapshot it was fetched for and no other', () => {
    const fetchedFor = snapshot();
    const held = scene();
    setFoldedFlatScene(3, fetchedFor, held);
    expect(foldedFlatScene(3, fetchedFor)).toBe(held);
    expect(foldedFlatScene(3, snapshot())).toBeUndefined();
    expect(foldedFlatScene(4, fetchedFor)).toBeUndefined();
    expect(foldedFlatScene(null, fetchedFor)).toBeUndefined();
  });

  it('keeps handle 0, which is a valid slot', () => {
    const fetchedFor = snapshot();
    setFoldedFlatScene(0, fetchedFor, scene());
    expect(foldedFlatScene(0, fetchedFor)).toBeDefined();
    setFoldedFlatScene(null, fetchedFor, scene());
    expect(foldedFlatSceneCount()).toBe(1);
  });

  it('replaces the table and tells subscribers, so a reader sees a landing as new data', () => {
    const before = foldedFlatScenes();
    const listener = vi.fn();
    const unsubscribe = subscribeFoldedFlatScenes(listener);
    setFoldedFlatScene(1, snapshot(), scene());
    expect(listener).toHaveBeenCalledTimes(1);
    expect(foldedFlatScenes()).not.toBe(before);
    // Dropping what is not held changes nothing and says nothing.
    dropFoldedFlatScene(9);
    expect(listener).toHaveBeenCalledTimes(1);
    dropFoldedFlatScene(1);
    expect(listener).toHaveBeenCalledTimes(2);
    expect(foldedFlatSceneCount()).toBe(0);
    unsubscribe();
    setFoldedFlatScene(1, snapshot(), scene());
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('goes with its handle', async () => {
    retainFoldedFigureHandle(5);
    setFoldedFlatScene(5, snapshot(), scene());
    releaseFoldedFigureHandle(5);
    expect(foldedFlatSceneCount()).toBe(0);
    retainFoldedFigureHandle(6);
    setFoldedFlatScene(6, snapshot(), scene());
    await resetFoldedFigureHandles();
    expect(foldedFlatSceneCount()).toBe(0);
  });
});
