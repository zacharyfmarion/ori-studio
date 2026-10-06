import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { trackDiagramAnnotationAdded } from '../../analytics';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { randomDiagramId, type DiagramAsset, type DiagramStep, type DiagramStyle, type KnownDiagramAnnotation } from '../document/diagramDocument';
import {
  bisectorPick,
  bisectorPreview,
  bisectorStep,
  bisectorUnpick,
  NO_PICKS,
  type Bisected,
  type BisectorPicks,
  type BisectorPress,
  type BisectorRefusal,
  type PickedLine,
} from './angleBisector';
import { ANGLE_BISECTOR, isPickTool, type AnnotateTool } from './annotateTools';
import { placePoint, snapOutcome, type SnapContext } from './annotateSnap';
import { angleMarkAt, cleanAnnotation, isDegenerate, MIN_ANNOTATION_LENGTH, type PicturePoint } from './annotationModel';
import { lineKindOf, type DiagramLineType } from './lineTypes';
import { setPickProgress, type AngleMarkStep } from './pickProgress';
import { nearestLine } from './nearestLine';
import type { SnapTarget } from './pictureSnap';

/**
 * What the next pick takes: a point; a line; either, the point first (the
 * first pick, which decides the way); or either, the line first (where the
 * bisector ends).
 */
type PickWants = 'point' | 'line' | 'point-first' | 'line-first';

function pickWants(tool: AnnotateTool, picks: BisectorPicks): PickWants {
  if (tool !== ANGLE_BISECTOR) return 'point';
  switch (picks.kind) {
    case 'points':
      return picks.points.length === 0 ? 'point-first' : picks.points.length < 3 ? 'point' : 'line-first';
    case 'lines':
      return picks.lines.length < 2 ? 'line' : 'line-first';
    case 'parallel':
      return 'line-first';
  }
}

function sameLine(a: PickedLine | null, b: PickedLine | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.a[0] === b.a[0] && a.a[1] === b.a[1] && a.b[0] === b.b[0] && a.b[1] === b.b[1];
}

/** What the canvas shows of a sequence in progress, over the marks. */
export interface PickPreview {
  /** The points picked so far. */
  points: readonly PicturePoint[];
  /** The lines picked, and the one under the pointer that a press would pick. */
  lines: readonly PickedLine[];
  hovered: PickedLine | null;
  /**
   * A press takes the hovered line outright — Equal Divisions divides it —
   * rather than picking it toward more: shown firmly, as what a click does.
   */
  hoverTakes?: boolean;
  /** Between two parallel lines, the midline the ends are aimed along. */
  midline: { at: PicturePoint; along: PicturePoint } | null;
}

const NO_PREVIEW: PickPreview = { points: [], lines: [], hovered: null, midline: null };

/**
 * Annotate's pick tools (15b): the Angle Bisector — Edit's, on the picture
 * (`angleBisector.ts`) — and the equal-angle mark put down on its own, three
 * points: an arm, the vertex, the other arm. Each press is a pick: a point,
 * snapped as a circle's centre is (⌘ puts it down freely), or a line of the
 * picture or one drawn on it under the press. The canvas hands a press here
 * while one of them is in hand; this keeps the picks, shows them and what the
 * next press would draw, takes the last back for Escape, and puts the
 * annotations down — the bisector's line, in the rail's line type, and its
 * mark — as one undo step.
 */
export function usePickTool({
  step,
  assets,
  style,
  tool,
  lineType,
  readOnly,
  snapContext,
  showSnap,
  reach,
}: {
  step: DiagramStep;
  assets: Readonly<Record<string, DiagramAsset>>;
  style: DiagramStyle;
  tool: AnnotateTool;
  lineType: DiagramLineType;
  readOnly: boolean;
  snapContext: () => SnapContext;
  showSnap: (targets: readonly (SnapTarget | null)[]) => void;
  /** How near a press must be to a line to pick it, in picture units, at the zoom now. */
  reach: () => number;
}) {
  const picks = useRef<BisectorPicks>(NO_PICKS);
  /** Whether the vertex — or the mark's vertex — snapped, for the event that counts it. */
  const snapped = useRef<{ vertex: boolean; free: boolean }>({ vertex: false, free: false });
  const [preview, setPreview] = useState<PickPreview>(NO_PREVIEW);
  const [drafts, setDrafts] = useState<readonly KnownDiagramAnnotation[]>([]);
  const active = isPickTool(tool);

  const say = useCallback(
    (refusal: BisectorRefusal | null = null) => {
      if (!isPickTool(tool)) {
        setPickProgress(null);
        return;
      }
      const current = picks.current;
      const step =
        tool === ANGLE_BISECTOR
          ? bisectorStep(current)
          : ((['arm', 'mark-vertex', 'other-arm'] as const)[current.kind === 'points' ? Math.min(current.points.length, 2) : 0] as AngleMarkStep);
      setPickProgress({ step, refusal });
    },
    [tool]
  );

  /** Show the picks as they are, and nothing under the pointer yet. */
  const showPicks = useCallback(() => {
    const current = picks.current;
    setPreview({
      points: current.kind === 'points' ? current.points : [],
      lines: current.kind === 'points' ? [] : current.lines,
      hovered: null,
      midline: current.kind === 'parallel' ? current.midline : null,
    });
    setDrafts([]);
  }, []);

  const reset = useCallback(() => {
    picks.current = NO_PICKS;
    snapped.current = { vertex: false, free: false };
    showPicks();
    say();
  }, [showPicks, say]);

  // Another tool, another step: the picks are dropped.
  useEffect(() => {
    reset();
    return () => setPickProgress(null);
  }, [reset, step.id]);

  /** The line of the picture, or drawn on it, nearest a press within reach; null for none (`nearestLine`). */
  const lineAt = useCallback(
    (at: PicturePoint): PickedLine | null => nearestLine(step, assets, style, at, reach()),
    [step, assets, style, reach]
  );

  /**
   * What a press at `at` offers the pick it is for (`wants`): a point — the
   * one it snaps to — a line under it, or either, the point first where both
   * would do (the first pick, as Edit takes it) or the line first (where the
   * bisector ends, as Edit's runs to a line). Held ⌘ (Ctrl), it is a point
   * where it is, snapped to nothing and on no line.
   */
  const pressAt = useCallback(
    (at: PicturePoint, free: boolean): { press: BisectorPress; target: SnapTarget | null } => {
      const wants = pickWants(tool, picks.current);
      if (free) return { press: { point: null, line: null, at }, target: null };
      const line = wants === 'line' || wants === 'line-first' ? lineAt(at) : null;
      if (wants === 'line' || (wants === 'line-first' && line)) return { press: { point: null, line, at }, target: null };
      const placed = placePoint(snapContext(), at, { free });
      const under = !placed.target && wants === 'point-first' ? lineAt(at) : null;
      return { press: { point: placed.target ? placed.at : null, line: under, at: placed.at }, target: placed.target };
    },
    [tool, snapContext, lineAt]
  );

  /** The annotations a finished sequence puts down: the bisector's line and its mark, or the mark alone. */
  const finish = useCallback(
    (drawn: Bisected | null, mark: { vertex: PicturePoint; arms: readonly [PicturePoint, PicturePoint] } | null) => {
      const store = useWorkspaceStore.getState();
      const made: KnownDiagramAnnotation[] = [];
      if (drawn) {
        const line = cleanAnnotation({ id: randomDiagramId('annotation'), kind: lineKindOf(lineType), ...drawn.line });
        if (!isDegenerate(line, MIN_ANNOTATION_LENGTH)) made.push(line);
      }
      const angle = drawn ? drawn.angle : mark;
      const placed = angle ? angleMarkAt(angle.vertex, angle.arms[0], angle.arms[1]) : null;
      if (placed && (made.length > 0 || !drawn)) {
        made.push(cleanAnnotation({ id: randomDiagramId('annotation'), kind: 'angle-mark', ...placed }));
      }
      if (made.length === 0) return;
      const added = store.editDiagramAnnotations(step.id, drawn ? 'Bisect angle' : 'Add annotation', (list) => [...list, ...made], {
        select: made[0]!.id,
        loadId: store.diagramLoadId,
      });
      if (!added) return;
      const { vertex, free } = snapped.current;
      const snap =
        drawn && picks.current.kind !== 'points'
          ? 'none'
          : snapOutcome('angle-mark', { enabled: snapContext().enabled, free, snapped: vertex });
      trackDiagramAnnotationAdded(drawn ? 'angle_bisector' : 'angle_mark', snap);
    },
    [lineType, step.id, snapContext]
  );

  /** A press: the next pick, and — the last — what it draws. Whether it was taken. */
  const press = useCallback(
    (at: PicturePoint, free: boolean): boolean => {
      if (!isPickTool(tool) || readOnly) return false;
      const { press: offered, target } = pressAt(at, free);
      const before = picks.current;
      // The vertex is the second point picked: its snap is what the event counts.
      if (before.kind === 'points' && before.points.length === 1) snapped.current = { vertex: target !== null, free };
      if (tool === 'angle-mark') {
        const points = before.kind === 'points' ? [...before.points, offered.point ?? offered.at] : [offered.point ?? offered.at];
        if (points.length < 3) {
          picks.current = { kind: 'points', points };
        } else {
          picks.current = NO_PICKS;
          const [arm, vertex, other] = points as [PicturePoint, PicturePoint, PicturePoint];
          const placed = angleMarkAt(vertex, arm, other);
          if (placed) finish(null, { vertex, arms: [arm, other] });
          showPicks();
          say(placed ? null : 'no-angle');
          showSnap([]);
          return true;
        }
        showPicks();
        say();
        showSnap([target]);
        return true;
      }
      const result = bisectorPick(before, offered);
      if (result.drawn) {
        // Counted from the picks it was drawn from, before they are dropped.
        finish(result.drawn, null);
      }
      picks.current = result.picks;
      showPicks();
      say(result.refused ?? null);
      showSnap(result.drawn || result.refused ? [] : [target]);
      return true;
    },
    [tool, readOnly, pressAt, finish, showPicks, say, showSnap]
  );

  /** The pointer over the stage: what a press there would pick, and what it would draw. */
  const hover = useCallback(
    (at: PicturePoint | null, free: boolean) => {
      if (!isPickTool(tool) || readOnly || at === null) {
        setPreview((current) => (current.hovered ? { ...current, hovered: null } : current));
        setDrafts((current) => (current.length === 0 ? current : []));
        return;
      }
      const { press: offered, target } = pressAt(at, free);
      showSnap([target]);
      setPreview((current) => (sameLine(current.hovered, offered.line) ? current : { ...current, hovered: offered.line }));
      if (tool !== ANGLE_BISECTOR) return;
      const drawn = bisectorPreview(picks.current, offered);
      if (!drawn) {
        setDrafts((current) => (current.length === 0 ? current : []));
        return;
      }
      const line: KnownDiagramAnnotation = { id: 'annotation-pick-line', kind: lineKindOf(lineType), ...drawn.line };
      const placed = drawn.angle ? angleMarkAt(drawn.angle.vertex, drawn.angle.arms[0], drawn.angle.arms[1]) : null;
      setDrafts(placed ? [line, { id: 'annotation-pick-mark', kind: 'angle-mark', ...placed }] : [line]);
    },
    [tool, readOnly, pressAt, showSnap, lineType]
  );

  /** Escape: the last pick taken back. Whether there was one. */
  const unpick = useCallback((): boolean => {
    if (!isPickTool(tool)) return false;
    const back = bisectorUnpick(picks.current);
    if (back === null) return false;
    picks.current = back;
    showPicks();
    say();
    showSnap([]);
    return true;
  }, [tool, showPicks, say, showSnap]);

  return useMemo(
    () => ({ active, press, hover, unpick, preview, drafts }),
    [active, press, hover, unpick, preview, drafts]
  );
}
