import { useCallback, useMemo, useState } from 'react';
import type { FillGeometry } from '../../../cp-workspace/renderer/types';
import { vertexDirectionOf } from '../../document/foldSequenceDocument';
import type { FoldToolState } from '../../tools/foldToolState';
import {
  swivelImpliedLanding,
  swivelLanding,
  swivelOffered,
  type FoldSwivelLanding,
  type FoldSwivelReachView,
} from '../../tools/vertex/swivelReach';
import type { FoldOverlayMarks } from '../foldPaneOverlays';
import type { FoldPendingCreases } from '../foldPaneScenes';
import type { FoldHit, FoldPaneId, FoldPickIndex, FoldSegmentPick } from '../foldPicking';
import type { FoldCanvasInks } from '../useFoldCanvasInks';
import { swivelRegionsTint, vertexCreaseLines, vertexOverlayMarks } from './vertexOverlay';

/** What a swivel's next click is offered and would make, drawn on the panes before it is clicked. */
export interface FoldSwivelMarks {
  /**
   * The lines a click takes, on each pane, lit under the picks: the edges
   * that can swing, then the lines the edge picked lands on. Null when the
   * swivel's reach offers nothing to choose among.
   */
  offered: Readonly<Record<FoldPaneId, readonly FoldSegmentPick[]>> | null;
  /** The swivel the line under the pointer would make, as it will be folded; null for none. */
  hovered: FoldSwivelLanding | null;
  /** Its creases, each in its diagram-crease pen. */
  pending: FoldPendingCreases | null;
  /** Its moving paper, lit over the folded pane, the part that carries the edge brightest. */
  tint: FillGeometry | null;
  /** Its vertex, and where its edge lands, bold, over the folded pane. */
  marks: FoldOverlayMarks | null;
  /** Told what is under the pointer on either pane (`FoldPane`'s `onHover`). */
  onHover: (hit: FoldHit | null) => void;
}

/**
 * A swivel's marks before its fold is previewed (owner feedback, 2026-10-12:
 * offer only what lands, and show it at every pick), from its reach
 * (`useFoldSwivelReach`):
 *
 * - **The edges that can swing**, once the meeting point is clicked, lit on
 *   both panes; the one under the pointer brighter. An edge whose line is
 *   implied — every line it lands on is one line of the folded form —
 *   previews that swivel as the pointer crosses it
 *   (`swivelImpliedLanding`).
 * - **The lines the edge picked lands on**, lit the same way; the one under
 *   the pointer previews the whole swivel — its creases in the diagram pens,
 *   its moving paper lit, the edge where it lands bold, the dot where the
 *   creases meet — exactly as the click on it previews it, from the same
 *   answer.
 *
 * Every mark is read from the reach the worker answered once for the pick,
 * so a pointer move asks nothing; it re-renders only when the line under it
 * changes.
 */
export function useFoldSwivelMarks(
  index: FoldPickIndex | null,
  tools: Pick<FoldToolState, 'tool' | 'picks'>,
  reach: FoldSwivelReachView | null,
  inks: FoldCanvasInks | null
): FoldSwivelMarks {
  const { tool, picks } = tools;
  const offer = useMemo(() => (tool === 'swivel' ? swivelOffered(reach, picks) : null), [tool, reach, picks]);
  const [hoveredLine, setHoveredLine] = useState<number | null>(null);

  const onHover = useCallback(
    (hit: FoldHit | null) => {
      const pick = hit?.pick;
      const line = offer && pick?.kind === 'segment' && offer(pick.edge) ? pick.edge : null;
      setHoveredLine((current) => (current === line ? current : line));
    },
    [offer]
  );

  const offered = useMemo<FoldSwivelMarks['offered']>(() => {
    if (!offer || !index) return null;
    const lit = (segments: readonly FoldSegmentPick[]) => segments.filter((segment) => offer(segment.edge));
    return { folded: lit(index.folded.segments), 'crease-pattern': lit(index.creasePattern.segments) };
  }, [offer, index]);

  // The swivel under the pointer: a line the edge picked lands on, or an edge whose line is implied.
  const line = offer ? hoveredLine : null;
  const hovered = useMemo(() => {
    if (line === null || !reach) return null;
    const edge = picks[1];
    return edge?.kind === 'segment' ? swivelLanding(reach, edge.edge, line) : swivelImpliedLanding(reach, line);
  }, [line, reach, picks]);

  const drawn = useMemo(() => {
    const analysis = hovered?.answer.analysis;
    if (!hovered || !index || analysis?.kind !== 'swivel-by-edge') return { pending: null, tint: null, marks: null };
    const pending: FoldPendingCreases = {
      folded: vertexCreaseLines(index, { analysis, emergent: null }, vertexDirectionOf(hovered.op)),
      creasePattern: [],
    };
    if (!inks) return { pending, tint: null, marks: null };
    return {
      pending,
      tint: swivelRegionsTint(index, analysis, inks.accent),
      marks: vertexOverlayMarks(index, { analysis, emergent: analysis.ridge, emergents: hovered.answer.emergents }, inks.overlay),
    };
  }, [hovered, index, inks]);

  return { offered, hovered, ...drawn, onHover };
}
