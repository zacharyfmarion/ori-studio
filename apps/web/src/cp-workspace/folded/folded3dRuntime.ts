/**
 * Where a 3D folded figure's camera lives *while the pointer is down*.
 *
 * Deliberately outside the store, for the reason `inlineSimulationRuntime.ts`
 * records at length: a per-frame transport field must not share an object with
 * document provenance. `setOristudioCpFolded3dCamera` used to be called on every
 * pointermove of an orbit, and each call produced a new
 * `oristudioCpFoldedFigures` array — which invalidates `staleFoldedFigureIds`
 * (a walk over every crease in the document, per frame), `foldedFigureObjects`,
 * `canvasObjects`, and re-renders the whole crease-pattern panel. That is Cause 2
 * of `implementation-plans/inline-simulation-performance.md`, which cost 901 ms
 * of main-thread time there and produced the same visible stutter.
 *
 * So the *live* camera is here and the *stored* camera stays on the entry: one
 * store write per drag, on release, where the single undo entry already lands.
 * The store remains exactly what would be written to disk.
 *
 * A frame carries the projected picture beside the camera because a figure that
 * cannot be windowed is still drawn through the CPU projector, and re-projecting
 * in a render pass would put `earcut` plus a BSP build inside React's commit. A
 * **windowed** figure publishes no snapshot at all — its mesh is drawn from the
 * camera alone — which is what takes the projector off the live path.
 *
 * There are therefore two ways out of here, and they are different on purpose:
 *
 * - {@link subscribeFolded3dOrbit} + {@link folded3dSceneOrbitFrames} for the
 *   crease-pattern canvas, which needs a *picture*. Its snapshot only changes
 *   when a snapshot does, so turning a windowed figure does not re-render it.
 * - {@link subscribeFolded3dOrbitCamera} for a window, which needs a *camera*
 *   and nothing else. It is imperative — no `useSyncExternalStore`, no props —
 *   because a camera frame arriving as React state re-renders every window in
 *   the layer, not just the one being turned. This is the same rule the
 *   simulator viewport already follows for solver frames, and for the same
 *   reason.
 *
 * Lifetime is one pointer gesture: published by the first move that turns the
 * figure, dropped on release by the same code that writes the store. Nothing
 * here survives a document replace ({@link clearAllFolded3dOrbits}).
 */

import type { OristudioCpFoldedRenderSnapshot } from '../../engine/oristudioCpTypes';
import type { FoldedFigureCamera } from './foldedFigure3dProjection';

/** One figure's live orbit state: where the eye is, and the picture from there. */
export interface Folded3dOrbitFrame {
  camera: FoldedFigureCamera;
  /**
   * The projection at {@link camera}, or `null` when the figure cannot be
   * re-projected at all — a figure reopened from a file has no render model, so
   * it keeps the picture it was saved with. The same answer
   * `reproject3dFigureAt` gives, and callers treat it the same way: keep what
   * you have rather than blanking the figure.
   */
  snapshot: OristudioCpFoldedRenderSnapshot | null;
}

/**
 * Replaced wholesale on every write rather than mutated, so
 * `useSyncExternalStore` can use it directly as the snapshot: identity changes
 * exactly when the contents do, and is stable in between. At most one figure is
 * ever in here (a pointer turns one figure), so copying costs nothing.
 */
let frames: ReadonlyMap<string, Folded3dOrbitFrame> = new Map();

/**
 * The subset of {@link frames} that carries a picture, held apart so its
 * identity survives a frame that carries none.
 *
 * A windowed figure publishes `snapshot: null` on every move of a turn, and the
 * crease-pattern canvas subscribes with `useSyncExternalStore` — which re-renders
 * whenever the snapshot object changes identity. Handing it the whole map made
 * turning a windowed figure re-render the canvas sixty times a second to deliver
 * a picture it had already decided not to draw.
 */
let sceneFrames: ReadonlyMap<string, Folded3dOrbitFrame> = new Map();

const listeners = new Set<() => void>();

/** Per-figure camera sinks, for the windows. See the module comment. */
const cameraListeners = new Map<string, Set<(camera: FoldedFigureCamera) => void>>();

/**
 * The picture-carrying frames, reusing `previous` when nothing about them
 * changed so `useSyncExternalStore` can bail out.
 */
function sceneFramesOf(
  next: ReadonlyMap<string, Folded3dOrbitFrame>,
  previous: ReadonlyMap<string, Folded3dOrbitFrame>,
): ReadonlyMap<string, Folded3dOrbitFrame> {
  const scene = new Map<string, Folded3dOrbitFrame>();
  for (const [id, frame] of next) {
    if (frame.snapshot !== null) scene.set(id, frame);
  }
  if (scene.size !== previous.size) return scene;
  for (const [id, frame] of scene) {
    if (previous.get(id) !== frame) return scene;
  }
  return previous;
}

function commit(next: ReadonlyMap<string, Folded3dOrbitFrame>): void {
  frames = next;
  sceneFrames = sceneFramesOf(next, sceneFrames);
  for (const listener of listeners) listener();
}

/** Subscribe to orbit frames appearing, changing or going away. */
export function subscribeFolded3dOrbit(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Take one figure's live camera as it is published, without React in between.
 *
 * Called on every move that turns or zooms `id`, and **not** called when the
 * gesture ends: the store is written before the live frame is dropped, so the
 * camera a window should settle at arrives through the figure it is rendered
 * from. Pushing a fallback on the clear instead would race that write and show
 * one frame back at the pre-drag camera.
 */
export function subscribeFolded3dOrbitCamera(
  id: string,
  listener: (camera: FoldedFigureCamera) => void,
): () => void {
  const existing = cameraListeners.get(id);
  const set = existing ?? new Set<(camera: FoldedFigureCamera) => void>();
  if (!existing) cameraListeners.set(id, set);
  set.add(listener);
  return () => {
    set.delete(listener);
    if (set.size === 0) cameraListeners.delete(id);
  };
}

/**
 * The live frames that carry a picture. For the crease-pattern canvas, which
 * draws pictures and has no use for a camera it cannot render from.
 */
export function folded3dSceneOrbitFrames(): ReadonlyMap<string, Folded3dOrbitFrame> {
  return sceneFrames;
}

/** Where a figure is being turned to right now, or `null` when it is not. */
export function getFolded3dOrbit(id: string): Folded3dOrbitFrame | null {
  return frames.get(id) ?? null;
}

/** Publish the camera a drag has reached, with the picture from it. */
export function publishFolded3dOrbit(id: string, frame: Folded3dOrbitFrame): void {
  const next = new Map(frames);
  next.set(id, frame);
  commit(next);
  // After the map, so a sink that reads back through `getFolded3dOrbit` sees the
  // frame it was just handed.
  const sinks = cameraListeners.get(id);
  if (sinks) for (const listener of sinks) listener(frame.camera);
}

/**
 * Drop a figure's live frame — the release half of a drag, after the store has
 * been written. A no-op (and no notification) when there was nothing live, so a
 * press that never turned anything wakes no subscriber.
 */
export function clearFolded3dOrbit(id: string): void {
  if (!frames.has(id)) return;
  const next = new Map(frames);
  next.delete(id);
  commit(next);
}

/** Drop everything — for a document replace, and for test isolation. */
export function clearAllFolded3dOrbits(): void {
  if (frames.size === 0) return;
  commit(new Map());
}

/** How many figures are being turned. For tests and diagnostics. */
export function folded3dOrbitCount(): number {
  return frames.size;
}
