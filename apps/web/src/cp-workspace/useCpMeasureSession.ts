import { useCallback, useEffect, useMemo, useState } from 'react';
import { useWorkspaceStore } from '../store/workspaceStore';
import type { Point } from '../lib/geometry';
import type { CpSnapTarget } from '../lib/creasePatternViewport';
import type { OristudioCpOperationId } from '../lib/oristudioCpCommands';
import type { OristudioCpToolPhase } from '../lib/oristudioCpToolState';
import {
  cpMeasureKindForOperation,
  isCpMeasurementOperation,
  type CpAngleUnit,
  type CpMeasureKind,
  type CpMeasureScale,
  type CpMeasureUnit,
  type CpMeasurement,
} from './measure';
import { readCpMeasurePreferences, writeCpMeasurePreferences } from './measurePreferences';

/**
 * The measure tool's whole state, in one place.
 *
 * Split by lifetime, which is the only thing that decides where a field lives:
 *
 * - **The readings** are in the store, because `historySlice.undo/redo` and
 *   `workspaceCapabilities` both have to agree with the canvas about them (see
 *   `measureSession.ts`).
 * - **The pick in progress** is local: it is a gesture, it follows the cursor,
 *   and nothing outside this surface can act on it.
 * - **The display units** are a persisted preference, so they survive the
 *   session entirely — a designer reads in the units they think in, whatever
 *   the file was authored in.
 *
 * This hook is also what enforces the invariant the store depends on: readings
 * exist **only while a measure tool is active**. That is what lets undo
 * ownership be decided from the array alone, with the store knowing nothing
 * about tool state.
 */
export interface CpMeasureSessionSurface {
  /** What the armed tool measures, or null when it is not a measure tool. */
  kind: CpMeasureKind | null;
  /** A measure tool is armed and live — what mounts the canvas layer. */
  active: boolean;
  /** Readings taken this session, oldest first. */
  measurements: readonly CpMeasurement[];
  /** The session-list row under the pointer, drawn emphasised on the canvas. */
  hoveredIndex: number | null;
  setHoveredIndex: (index: number | null) => void;
  /** Record a reading the kernel just returned. */
  take: (measurement: CpMeasurement) => void;
  /**
   * Take back the newest reading — the same stack Undo pops, so Delete and
   * Cmd+Z cannot disagree and Redo restores either. False when there is none.
   */
  dropLast: () => boolean;
  /** Points placed so far in the pick in progress, for the step prompt. */
  picked: number;
  setPicked: (picked: number) => void;
  /** The placed points plus the cursor, so the figure tracks the mouse. */
  livePoints: readonly Point[];
  setLivePoints: (points: readonly Point[]) => void;
  /** Kernel value for the live pick once it has all its points. */
  liveValue: number | null;
  setLiveValue: (value: number | null) => void;
  /** What the cursor is snapped onto, so a reading never silently reads between
   *  two points that only look like vertices. */
  snapKind: CpSnapTarget['kind'] | null;
  setSnapKind: (kind: CpSnapTarget['kind'] | null) => void;
  /** Forget the pick in progress. The readings stay. */
  clearPick: () => void;
  unit: CpMeasureUnit;
  angleUnit: CpAngleUnit;
  /** What one model unit is worth for the document being measured. */
  scale: CpMeasureScale;
  setUnit: (unit: CpMeasureUnit) => void;
  setAngleUnit: (angleUnit: CpAngleUnit) => void;
  setPaperEdgeMm: (paperEdgeMm: number) => void;
}

export function useCpMeasureSession({
  operationId,
  toolPhase,
  paperEdge,
  gridWidth,
}: {
  /** The armed tool's kernel operation — `cpToolState.activeOperationId`. */
  operationId: OristudioCpOperationId | null;
  toolPhase: OristudioCpToolPhase;
  /** Model-space width of the paper frame: the "paper edge = 1" reference. */
  paperEdge: number;
  /** Model-space width of one grid square, from the document's own grid. */
  gridWidth: number | undefined;
}): CpMeasureSessionSurface {
  const measurements = useWorkspaceStore((state) => state.oristudioCpMeasureSession.taken);
  const takeMeasurement = useWorkspaceStore((state) => state.takeOristudioCpMeasurement);
  const undoMeasurement = useWorkspaceStore((state) => state.undoOristudioCpMeasurement);
  const endSession = useWorkspaceStore((state) => state.endOristudioCpMeasureSession);

  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [picked, setPicked] = useState(0);
  const [livePoints, setLivePoints] = useState<readonly Point[]>([]);
  const [liveValue, setLiveValue] = useState<number | null>(null);
  const [snapKind, setSnapKind] = useState<CpSnapTarget['kind'] | null>(null);
  const [preferences, setPreferences] = useState(readCpMeasurePreferences);

  // Which measure tool is armed decides what is being measured — there is no
  // kind parameter: Measure Length and Measure Angle are separate tools.
  const kind = cpMeasureKindForOperation(operationId);
  const active = toolPhase === 'active' && isCpMeasurementOperation(operationId);

  const clearPick = useCallback(() => {
    setPicked(0);
    setLivePoints([]);
    setLiveValue(null);
  }, []);

  /**
   * V1 measurement lifetime: a reading lives only while the measure tool is
   * active. Escape deactivates the tool and switching tools changes the
   * operation, so both paths land here.
   *
   * This is the invariant `historySlice` reads the session through, so it has to
   * be one effect on one condition rather than a clear at each exit.
   */
  useEffect(() => {
    if (active) return;
    endSession();
    setHoveredIndex(null);
    clearPick();
    setSnapKind(null);
  }, [active, clearPick, endSession]);

  // The session is this surface's, not the document's: a panel that goes away
  // takes its readings with it, or they would reappear over whatever the canvas
  // shows when it comes back.
  useEffect(() => endSession, [endSession]);

  const take = useCallback(
    (measurement: CpMeasurement) => {
      takeMeasurement(measurement);
      setHoveredIndex(null);
    },
    [takeMeasurement]
  );

  const dropLast = useCallback(() => {
    if (!undoMeasurement()) return false;
    setHoveredIndex(null);
    return true;
  }, [undoMeasurement]);

  const setUnit = useCallback((unit: CpMeasureUnit) => {
    setPreferences((current) => {
      const next = { ...current, unit };
      writeCpMeasurePreferences(next);
      return next;
    });
  }, []);
  const setAngleUnit = useCallback((angleUnit: CpAngleUnit) => {
    setPreferences((current) => {
      const next = { ...current, angleUnit };
      writeCpMeasurePreferences(next);
      return next;
    });
  }, []);
  const setPaperEdgeMm = useCallback((paperEdgeMm: number) => {
    setPreferences((current) => {
      const next = { ...current, paperEdgeMm };
      writeCpMeasurePreferences(next);
      return next;
    });
  }, []);

  // The grid width comes from the document's own grid, so "grid squares" tracks
  // a grid change.
  const scale = useMemo<CpMeasureScale>(
    () => ({
      paperEdge,
      gridWidth: gridWidth ?? paperEdge,
      paperEdgeMm: preferences.paperEdgeMm,
    }),
    [paperEdge, gridWidth, preferences.paperEdgeMm]
  );

  return {
    kind,
    active,
    measurements,
    hoveredIndex,
    setHoveredIndex,
    take,
    dropLast,
    picked,
    setPicked,
    livePoints,
    setLivePoints,
    liveValue,
    setLiveValue,
    snapKind,
    setSnapKind,
    clearPick,
    unit: preferences.unit,
    angleUnit: preferences.angleUnit,
    scale,
    setUnit,
    setAngleUnit,
    setPaperEdgeMm,
  };
}
