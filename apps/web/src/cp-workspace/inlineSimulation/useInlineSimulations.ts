import { useCallback, useMemo, useState } from 'react';
import { useWorkspaceStore } from '../../store/workspaceStore';
import type { OristudioCpDocumentState } from '../../engine/oristudioCpTypes';
import type { CanvasObjectBoxUpdate } from '../CanvasObjectOverlay';
import { inlineSimulationAsTransformable, isInlineSimulationStale } from './inlineSimulation';

export interface UseInlineSimulationsOptions {
  /** The live CP document, for the staleness check. */
  cpDocument: OristudioCpDocumentState | null | undefined;
}

/**
 * The inline-simulation binding layer: derived state, the store-bound verbs the
 * floating toolbar renders from, and the two pieces of transport state that the
 * descriptor deliberately does not carry.
 *
 * Windows are the third canvas-object kind, so this mirrors `useFoldedFigures`
 * and `useCpAnnotations` — the panel gets one object per concern instead of a
 * memo per field. What is different is what stays out of the store: a window's
 * solver lives in {@link InlineSimulationLayer}, so "playing" and "back to flat"
 * are transport, not document state, and both live here as plain React state.
 */
export function useInlineSimulations({ cpDocument }: UseInlineSimulationsOptions) {
  // Windows share the app-wide simulator settings rather than each carrying
  // their own: they are views of the same paper, and per-window material would
  // be a settings surface nobody asked for.
  const settings = useWorkspaceStore((state) => state.simulatorSettings);
  const setSetting = useWorkspaceStore((state) => state.setSimulatorSetting);
  const simulations = useWorkspaceStore((state) => state.oristudioCpInlineSimulations);
  const focusedId = useWorkspaceStore((state) => state.oristudioCpFocusedInlineSimulationId);
  const updateSimulation = useWorkspaceStore(
    (state) => state.updateOristudioCpInlineSimulation
  );
  const removeSimulation = useWorkspaceStore(
    (state) => state.removeOristudioCpInlineSimulation
  );
  const focusSimulation = useWorkspaceStore((state) => state.focusOristudioCpInlineSimulation);
  const refreshSimulation = useWorkspaceStore(
    (state) => state.refreshOristudioCpInlineSimulation
  );

  const transformableObjects = useMemo(
    () => simulations.map(inlineSimulationAsTransformable),
    [simulations]
  );

  /**
   * Which windows no longer match the creases they were built from. Derived here
   * once per document revision rather than stamped during the edit — the same
   * shape `useFoldedFigures` uses, and for the same reason.
   */
  const staleIds = useMemo(() => {
    const stale = new Set<string>();
    for (const simulation of simulations) {
      if (isInlineSimulationStale(cpDocument?.document, simulation)) stale.add(simulation.id);
    }
    return stale;
  }, [simulations, cpDocument?.document]);

  const selected = useMemo(
    () => simulations.find((simulation) => simulation.id === focusedId) ?? null,
    [simulations, focusedId]
  );

  const isInlineSimulationId = useCallback(
    (id: string) => simulations.some((simulation) => simulation.id === id),
    [simulations]
  );

  const [playing, setPlaying] = useState(false);

  /**
   * Bumped to return the focused window's fold to flat.
   *
   * The solver lives in the layer, not in the descriptor, so this cannot be done
   * by writing to the store. A nonce is how the panel reaches into the canvas
   * imperatively elsewhere too (see `cameraCommand`).
   */
  const [replayRequest, setReplayRequest] = useState(0);

  /**
   * The focused window's body takes no overlay gestures: its interior orbits the
   * fold, and the overlay polygon sits above it, so leaving it live meant every
   * drag aimed at the simulation moved the window instead. Handles are untouched,
   * so it can still be resized and rotated.
   */
  const inertBodyIds = useMemo(
    () => new Set(focusedId ? [focusedId] : []),
    [focusedId]
  );

  const applyBoxUpdate = useCallback(
    (id: string, patch: CanvasObjectBoxUpdate) => {
      const simulation = useWorkspaceStore
        .getState()
        .oristudioCpInlineSimulations.find((candidate) => candidate.id === id);
      if (!simulation) return;
      updateSimulation(id, {
        box: {
          center: patch.center ?? simulation.box.center,
          width: patch.width ?? simulation.box.width,
          height: patch.height ?? simulation.box.height,
          rotation: patch.rotation ?? simulation.box.rotation,
        },
      });
    },
    [updateSimulation]
  );

  /** Focus a window, pausing it if focus actually moved to a different one. */
  const focus = useCallback(
    (id: string) => {
      if (id !== focusedId) setPlaying(false);
      focusSimulation(id);
    },
    [focusedId, focusSimulation]
  );

  /** Hand the solver back, so at most one window is ever live. */
  const blur = useCallback(() => {
    setPlaying(false);
    focusSimulation(null);
  }, [focusSimulation]);

  const setFoldPercent = useCallback(
    (id: string, foldPercent: number) => updateSimulation(id, { foldPercent }),
    [updateSimulation]
  );

  /** Scrubbing is a manual override, so it stops playback. */
  const scrub = useCallback(
    (id: string, foldPercent: number) => {
      setPlaying(false);
      updateSimulation(id, { foldPercent });
    },
    [updateSimulation]
  );

  const replay = useCallback(() => setReplayRequest((nonce) => nonce + 1), []);
  const togglePlay = useCallback(() => setPlaying((current) => !current), []);
  const refresh = useCallback(
    (id: string) => void refreshSimulation(id),
    [refreshSimulation]
  );

  return {
    simulations,
    transformableObjects,
    focusedId,
    selected,
    staleIds,
    settings,
    setSetting,
    isInlineSimulationId,
    inertBodyIds,
    playing,
    setPlaying,
    togglePlay,
    replayRequest,
    replay,
    focus,
    blur,
    applyBoxUpdate,
    setFoldPercent,
    scrub,
    refresh,
    remove: removeSimulation,
  };
}
