import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clearAllFolded3dOrbits,
  clearFolded3dOrbit,
  folded3dOrbitCount,
  folded3dOrbitFrames,
  getFolded3dOrbit,
  publishFolded3dOrbit,
  subscribeFolded3dOrbit,
} from './folded3dRuntime';

const CAMERA = { yaw: 0.25, pitch: 0.5, zoom: 1 };

afterEach(() => {
  clearAllFolded3dOrbits();
});

describe('folded3dRuntime', () => {
  it('holds a figure’s live camera and hands it back', () => {
    publishFolded3dOrbit('a', { camera: CAMERA, snapshot: null });
    expect(getFolded3dOrbit('a')).toEqual({ camera: CAMERA, snapshot: null });
    expect(getFolded3dOrbit('b')).toBeNull();
    expect(folded3dOrbitCount()).toBe(1);
  });

  it('replaces the frames object on every change, so useSyncExternalStore can read it', () => {
    // The snapshot has to change identity exactly when the contents do, and be
    // stable in between — a mutated Map would make React either miss the frame
    // or re-render forever.
    const empty = folded3dOrbitFrames();
    publishFolded3dOrbit('a', { camera: CAMERA, snapshot: null });
    const first = folded3dOrbitFrames();
    expect(first).not.toBe(empty);
    expect(folded3dOrbitFrames()).toBe(first);

    publishFolded3dOrbit('a', { camera: { ...CAMERA, yaw: 0.3 }, snapshot: null });
    expect(folded3dOrbitFrames()).not.toBe(first);
  });

  it('wakes subscribers on publish and on a clear that removed something', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeFolded3dOrbit(listener);

    publishFolded3dOrbit('a', { camera: CAMERA, snapshot: null });
    expect(listener).toHaveBeenCalledTimes(1);

    // A press that never turned anything releases without ever publishing. It
    // must not wake the canvas, which would rebuild the folded geometry for a
    // click.
    clearFolded3dOrbit('b');
    expect(listener).toHaveBeenCalledTimes(1);

    clearFolded3dOrbit('a');
    expect(listener).toHaveBeenCalledTimes(2);
    expect(folded3dOrbitCount()).toBe(0);

    // And the empty clear that a document replace performs is likewise silent.
    clearAllFolded3dOrbits();
    expect(listener).toHaveBeenCalledTimes(2);

    unsubscribe();
    publishFolded3dOrbit('a', { camera: CAMERA, snapshot: null });
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('drops everything on a document replace', () => {
    publishFolded3dOrbit('a', { camera: CAMERA, snapshot: null });
    publishFolded3dOrbit('b', { camera: CAMERA, snapshot: null });
    clearAllFolded3dOrbits();
    expect(folded3dOrbitCount()).toBe(0);
    expect(getFolded3dOrbit('a')).toBeNull();
  });
});
