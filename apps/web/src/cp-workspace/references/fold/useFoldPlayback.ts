import { useCallback, useEffect, useState, useSyncExternalStore, type RefObject } from 'react';
import { ANALYTICS_EVENTS, track } from '../../../analytics';
import type { FoldScene } from './foldScene';
import { FoldTransport, type FoldPoseSink, type FoldTransportStatus } from './foldTransport';

export interface FoldPlaybackController extends FoldTransportStatus {
  toggle: () => void;
}

export interface FoldPlaybackInput {
  view: RefObject<FoldPoseSink | null>;
  /** The layer drawing the step's symbols, which fade as the paper they mark moves. */
  symbols?: RefObject<FoldPoseSink | null>;
  /** The card's fold, or null when the card has none. A new object is a new card. */
  scene: FoldScene | null;
  /** Play on arriving at a fold card. */
  autoPlay: boolean;
}

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * The fold's transport, bound to a panel: one `FoldTransport` for the life of
 * the panel, fed the active card's fold and the auto-play preference, and
 * read through `useSyncExternalStore` so a frame never re-renders anything
 * and a transition re-renders exactly the button.
 */
export function useFoldPlayback({
  view,
  symbols,
  scene,
  autoPlay,
}: FoldPlaybackInput): FoldPlaybackController {
  const [transport] = useState(
    () =>
      new FoldTransport({
        // One pose, every surface that draws the paper: the refs are read at
        // each push, since either may mount after the transport.
        sink: () => ({
          setFoldPose: (pose) => {
            view.current?.setFoldPose(pose);
            symbols?.current?.setFoldPose(pose);
          },
        }),
        reducedMotion: prefersReducedMotion,
        onPlay: (trigger, heading, kind, way) =>
          track(ANALYTICS_EVENTS.referencesFoldPlayed, {
            trigger,
            direction: heading,
            step_kind: kind === 'turn-over' ? 'turn_over' : kind,
            tab: kind === 'reference' ? 'find' : 'sequence',
            ...(way ? { way } : {}),
          }),
      })
  );
  useEffect(() => {
    transport.setAutoPlay(autoPlay);
  }, [transport, autoPlay]);
  useEffect(() => {
    transport.setScene(scene);
  }, [transport, scene]);
  useEffect(() => () => transport.dispose(), [transport]);
  const status = useSyncExternalStore(transport.subscribe, transport.status, transport.status);
  const toggle = useCallback(() => transport.toggle(), [transport]);
  return { ...status, toggle };
}
