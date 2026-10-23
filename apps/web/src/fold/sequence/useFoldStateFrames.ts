import { useEffect, useMemo } from 'react';
import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import { reportError } from '../../monitoring';
import { foldSession } from '../../store/workspaceStore/foldSession';
import type { FoldEngineStateHandle } from '../engine/foldEnginePort';
import type { FoldScene } from '../engine/foldEngineWire';
import type { FoldSession } from '../session/foldSession';
import { FOLD_SCENE_QUERY } from '../session/foldStateQueries';
import { foldStateFrame, type FoldStateFrame } from './foldStateFrame';

/**
 * Each landed state's frame (`foldStateFrame`), built once per state from its
 * scene and kept for every surface: the strip and the Step pane read the
 * same states, and a state never changes under its handle. The
 * scene is the one the canvas asks for (`FOLD_SCENE_QUERY` through
 * `FoldSession.query`), so the engine is asked it once, and a state whose
 * scene is already in — a committed preview's — has its frame at once.
 *
 * Kept by handle, newest last, up to {@link MAX_FRAMES}: a long sequence's
 * path and its neighbours, with room. A handle from a newer engine lets every
 * older one go, since a worker that went away took its states with it.
 */
const MAX_FRAMES = 192;

const frames = createStore<{ byHandle: ReadonlyMap<string, FoldStateFrame> }>(() => ({ byHandle: new Map() }));

/** Asked and not yet answered, so a state is asked once however many surfaces want it. */
const asking = new Set<string>();

const handleKey = (state: FoldEngineStateHandle) => `${state.generation}:${state.id}`;

/** Frames built from a scene the session already had, by the scene: built once, kept until it goes. */
const builtFrom = new WeakMap<FoldScene, FoldStateFrame>();

function frameOf(scene: FoldScene): FoldStateFrame {
  let frame = builtFrom.get(scene);
  if (!frame) {
    frame = foldStateFrame(scene);
    builtFrom.set(scene, frame);
  }
  return frame;
}

function keep(state: FoldEngineStateHandle, frame: FoldStateFrame): void {
  const next = new Map<string, FoldStateFrame>();
  for (const [key, held] of frames.getState().byHandle) {
    if (Number(key.split(':')[0]) >= state.generation) next.set(key, held);
  }
  next.set(handleKey(state), frame);
  for (const oldest of next.keys()) {
    if (next.size <= MAX_FRAMES) break;
    next.delete(oldest);
  }
  frames.setState({ byHandle: next });
}

/** Ask the engine for a state's frame, unless it is held or on its way. */
export function requestFoldStateFrame(session: FoldSession, state: FoldEngineStateHandle): void {
  const key = handleKey(state);
  if (frames.getState().byHandle.has(key) || asking.has(key)) return;
  asking.add(key);
  session.query(state, FOLD_SCENE_QUERY).then(
    (answer) => {
      asking.delete(key);
      // A state that went with its engine is asked again under its next handle.
      if (answer.status === 'answered') keep(state, frameOf(answer.value));
    },
    (error: unknown) => {
      asking.delete(key);
      // Not the user's to act on: the card shows no picture, and the next state asks again.
      reportError(error, { surface: 'fold:state-frame' });
    }
  );
}

/** The frame of a state, if held. */
export function heldFoldStateFrame(state: FoldEngineStateHandle | null): FoldStateFrame | null {
  return state ? (frames.getState().byHandle.get(handleKey(state)) ?? null) : null;
}

/** Forget every frame: for tests. */
export function clearFoldStateFrames(): void {
  asking.clear();
  frames.setState({ byHandle: new Map() });
}

/**
 * The frames of these states, in order: null for a state not held yet — it is
 * asked for — and for no state. Re-renders when one of them lands.
 */
export function useFoldStateFrames(states: readonly (FoldEngineStateHandle | null)[]): (FoldStateFrame | null)[] {
  const session = foldSession();
  const byHandle = useStore(frames, (snapshot) => snapshot.byHandle);
  useEffect(() => {
    for (const state of states) if (state) requestFoldStateFrame(session, state);
  }, [session, states]);
  return useMemo(
    () =>
      states.map((state) => {
        if (!state) return null;
        const held = byHandle.get(handleKey(state));
        if (held) return held;
        // A scene the session already has, from another surface: its frame now, not a turn later.
        const scene = session.peek(state, FOLD_SCENE_QUERY);
        return scene ? frameOf(scene.value) : null;
      }),
    [session, byHandle, states]
  );
}
