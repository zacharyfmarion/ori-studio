import { afterEach, describe, expect, it, vi } from 'vitest';
import type { OristudioCpFoldedRenderSnapshot } from '../../engine/oristudioCpTypes';
import {
  clearAllFolded3dOrbits,
  clearFolded3dOrbit,
  folded3dOrbitCount,
  folded3dSceneOrbitFrames,
  getFolded3dOrbit,
  publishFolded3dOrbit,
  subscribeFolded3dOrbit,
  subscribeFolded3dOrbitCamera,
} from './folded3dRuntime';

const CAMERA = { yaw: 0.25, pitch: 0.5, zoom: 1 };

/** Stands in for a projection: only its identity is read here. */
function snapshot(): OristudioCpFoldedRenderSnapshot {
  return { primitives: [] } as unknown as OristudioCpFoldedRenderSnapshot;
}

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

  it('replaces the scene frames on every picture, so useSyncExternalStore can read them', () => {
    // The snapshot has to change identity exactly when the contents do, and be
    // stable in between — a mutated Map would make React either miss the frame
    // or re-render forever.
    const empty = folded3dSceneOrbitFrames();
    publishFolded3dOrbit('a', { camera: CAMERA, snapshot: snapshot() });
    const first = folded3dSceneOrbitFrames();
    expect(first).not.toBe(empty);
    expect(folded3dSceneOrbitFrames()).toBe(first);

    publishFolded3dOrbit('a', { camera: { ...CAMERA, yaw: 0.3 }, snapshot: snapshot() });
    expect(folded3dSceneOrbitFrames()).not.toBe(first);
  });

  it('holds the scene frames still while a windowed figure turns', () => {
    // A windowed figure publishes a camera and no picture, sixty times a second.
    // The crease-pattern canvas draws pictures, so it must not be woken by any
    // of them — its `useSyncExternalStore` bails out only if this object keeps
    // its identity.
    const empty = folded3dSceneOrbitFrames();
    publishFolded3dOrbit('a', { camera: CAMERA, snapshot: null });
    expect(folded3dSceneOrbitFrames()).toBe(empty);
    publishFolded3dOrbit('a', { camera: { ...CAMERA, yaw: 0.9 }, snapshot: null });
    expect(folded3dSceneOrbitFrames()).toBe(empty);
    clearFolded3dOrbit('a');
    expect(folded3dSceneOrbitFrames()).toBe(empty);

    // Non-vacuous: the same publishes *with* a picture do move it.
    publishFolded3dOrbit('a', { camera: CAMERA, snapshot: snapshot() });
    expect(folded3dSceneOrbitFrames()).not.toBe(empty);
  });

  it('hands one figure’s live camera to its window and to no other', () => {
    const mine = vi.fn();
    const theirs = vi.fn();
    const unsubscribe = subscribeFolded3dOrbitCamera('a', mine);
    const unsubscribeTheirs = subscribeFolded3dOrbitCamera('b', theirs);

    publishFolded3dOrbit('a', { camera: CAMERA, snapshot: null });
    expect(mine).toHaveBeenCalledTimes(1);
    expect(mine).toHaveBeenCalledWith(CAMERA);
    expect(theirs).not.toHaveBeenCalled();

    // The clear is silent on purpose: the store is written before it, so the
    // camera to settle at reaches a window through its figure. Pushing here as
    // well would race that write and show a frame at the pre-drag camera.
    clearFolded3dOrbit('a');
    expect(mine).toHaveBeenCalledTimes(1);

    unsubscribe();
    publishFolded3dOrbit('a', { camera: CAMERA, snapshot: null });
    expect(mine).toHaveBeenCalledTimes(1);
    unsubscribeTheirs();
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
