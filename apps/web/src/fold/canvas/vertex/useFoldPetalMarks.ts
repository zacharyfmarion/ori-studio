import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Point } from '../../../lib/geometry';
import { canonicalJson } from '../../document/foldDigest';
import type { FoldPetalAnalysis, FoldVertexAnalysis } from '../../engine/foldEngineSquashWire';
import type { FoldSessionSurface } from '../../session/useFoldSession';
import type { FoldToolState } from '../../tools/foldToolState';
import { petalRegionOnFolded, petalRegionOnSheet, sameKite } from '../../tools/vertex/petalGeometry';
import {
  petalHingeClicks,
  petalHingeOf,
  petalOpAt,
  petalRegionKey,
  picksPetalRegion,
  type FoldVertexIntent,
} from '../../tools/vertex/vertexStep';
import type { FoldOverlayRegions } from '../foldPaneOverlays';
import type { FoldPaneCreaseLine, FoldPendingCreases } from '../foldPaneScenes';
import type { FoldHit, FoldPaneId, FoldPickIndex } from '../foldPicking';
import { useFoldFlapAnswers } from './useFoldFlapAnswers';
import { vertexCreaseLines } from './vertexOverlay';

/** What a petal fold's clicks draw on the panes before its flap is folded, and the hover that feeds them. */
export interface FoldPetalMarks {
  /** While the flap is picked, or picked again: the flaps the engine has described on each pane, and the one picked. */
  regions: Readonly<Record<FoldPaneId, FoldOverlayRegions>> | null;
  /**
   * The hinge as its two ends are clicked — from the first to the point under
   * the pointer, then between both — and, over a flap, its hinge and kite
   * creases as the engine names them, each in its diagram-crease pen.
   */
  pending: FoldPendingCreases | null;
  /** The flap under the pointer, as the engine described it; null off one, or before it has. */
  hovered: FoldPetalAnalysis | null;
  /** Told what is under the pointer on either pane (`FoldPane`'s `onHover`). */
  onHover: (hit: FoldHit | null) => void;
}

/** A petal the engine describes, from its answer: none for another kind's. */
const readPetal = (analysis: FoldVertexAnalysis): FoldPetalAnalysis | null => (analysis.kind === 'petal' ? analysis : null);

/** A distinct flap the engine described, and its pieces on each pane. */
interface Flap {
  analysis: FoldPetalAnalysis;
  folded: Point[][];
  sheet: Point[][];
}

const NO_CREASES: FoldPendingCreases = { folded: [], creasePattern: [] };

/** The scene point a hit names on the paper: a free pick's, on either pane. */
function paperOf(hit: FoldHit | null): Point | null {
  return hit?.pick?.kind === 'free' && hit.pick.sheet ? hit.pick.scene : null;
}

/**
 * A petal fold's marks (owner feedback, 2026-10-12: feedback at every pick).
 *
 * - **The hinge**, named by its two ends: from the first end to the point
 *   under the pointer, then between both, in the diagram-crease pen of the
 *   direction — the crease the fold will make.
 * - **The flap below it**: once the hinge is named, each flap under the
 *   pointer is asked of the engine (the compound question, once per flap: a
 *   key of the layer there and the hinge's side, `petalRegionKey`). A flap it
 *   describes is lit where the pointer is, on both panes — the kite that
 *   lifts — with its hinge and kite creases in their pens; a click there
 *   picks it, and while it is previewed another click picks another. A place
 *   the engine names no flap at is not lit: a click there is refused, in
 *   words that say why (`vertexRefusal`).
 *
 * Null regions and creases for any other tool, and before the hinge is named.
 */
export function useFoldPetalMarks(
  session: FoldSessionSurface,
  index: FoldPickIndex | null,
  tools: Pick<FoldToolState, 'tool' | 'petalHinge' | 'picks' | 'vertexDirection'>
): FoldPetalMarks {
  const state = session.cursor.state;
  const stateKey = state ? `${state.generation}:${state.id}` : null;
  const { tool, petalHinge, picks, vertexDirection: direction } = tools;
  const petal = tool === 'petal';
  const intent = useMemo<Pick<FoldVertexIntent, 'petalHinge' | 'picks' | 'direction'>>(
    () => ({ petalHinge, picks, direction }),
    [petalHinge, picks, direction]
  );
  const clicks = petalHingeClicks(intent);
  const choosing = picksPetalRegion(tool, petalHinge, picks.length);
  const hinge = useMemo(() => (choosing ? petalHingeOf(intent) : null), [choosing, intent]);
  const scope = hinge && stateKey ? `${stateKey}|${canonicalJson(hinge)}|${direction}` : null;

  const [hoveredKey, setHoveredKey] = useState<string | null>(null);
  const [liveEnd, setLiveEnd] = useState<Point | null>(null);
  const { byKey, ask: askOp } = useFoldFlapAnswers(session, scope, readPetal, 'fold:petal-region');

  /** Ask the engine about the flap at a point of the folded pane, once per key. */
  const ask = useCallback(
    (key: string, at: Point) => {
      if (index) askOp(key, petalOpAt(index, intent, at));
    },
    [index, intent, askOp]
  );

  const onHover = useCallback(
    (hit: FoldHit | null) => {
      if (!petal || !index) return;
      // The hinge's second end: the line runs from the first to the point under the pointer.
      const drawing = petalHinge === 'points' && picks.length === 1;
      const end = drawing && hit?.pick?.kind === 'point' ? hit.pick.scene : null;
      setLiveEnd((current) => (current?.x === end?.x && current?.y === end?.y ? current : end));
      const at = choosing ? paperOf(hit) : null;
      const key = at ? petalRegionKey(index, intent, at) : null;
      setHoveredKey(key);
      if (key && at) ask(key, at);
    },
    [petal, index, petalHinge, picks.length, choosing, intent, ask]
  );

  // The flap picked — by a click, or a verb that picked for the folder — is asked about too.
  const pickedPick = choosing && picks.length === clicks + 1 ? picks[clicks] : undefined;
  const pickedAt = pickedPick?.kind === 'free' && pickedPick.sheet ? pickedPick.scene : null;
  const pickedKey = pickedAt && index ? petalRegionKey(index, intent, pickedAt) : null;
  useEffect(() => {
    if (pickedKey && pickedAt) ask(pickedKey, pickedAt);
    // The point is read through its key: an equal key must not ask again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickedKey, ask]);

  // --- The flaps the engine described, each once, with where each key lies.
  const flaps = useMemo(() => {
    const list: Flap[] = [];
    const of = new Map<string, number>();
    if (!index) return { list, of };
    for (const [key, answer] of Object.entries(byKey)) {
      if (answer.status !== 'flap') continue;
      let at = list.findIndex((flap) => sameKite(flap.analysis, answer.analysis));
      if (at < 0) {
        at = list.length;
        list.push({
          analysis: answer.analysis,
          folded: petalRegionOnFolded(index, answer.analysis),
          sheet: petalRegionOnSheet(index, answer.analysis),
        });
      }
      of.set(key, at);
    }
    return { list, of };
  }, [index, byKey]);

  const regions = useMemo<FoldPetalMarks['regions']>(() => {
    if (!choosing || !index) return null;
    const picked = pickedKey === null ? null : (flaps.of.get(pickedKey) ?? null);
    const at = (hit: FoldHit) => {
      const scene = paperOf(hit);
      const key = scene ? petalRegionKey(index, intent, scene) : null;
      return key === null ? null : (flaps.of.get(key) ?? null);
    };
    return {
      folded: { polygons: flaps.list.map((flap) => flap.folded), picked, at },
      'crease-pattern': { polygons: flaps.list.map((flap) => flap.sheet), picked, at },
    };
  }, [choosing, index, intent, pickedKey, flaps]);

  // --- The creases pending: the flap under the pointer's, else the hinge as its ends are clicked.
  const hoveredFlap = choosing && hoveredKey !== null ? (flaps.list[flaps.of.get(hoveredKey) ?? -1] ?? null) : null;
  const hovered = hoveredFlap?.analysis ?? null;
  const previewing = picks.length > clicks;
  const pending = useMemo<FoldPendingCreases | null>(() => {
    if (!petal || !index || previewing) return null;
    if (hovered) {
      const folded = vertexCreaseLines(index, { analysis: { kind: 'petal', ...hovered }, emergent: null }, direction);
      return { folded, creasePattern: [] };
    }
    if (petalHinge !== 'points') return NO_CREASES;
    const [first, second] = picks;
    const from = first?.kind === 'point' ? first.scene : null;
    const to = second?.kind === 'point' ? second.scene : liveEnd;
    if (!from || !to) return NO_CREASES;
    const line: FoldPaneCreaseLine = { line: [from, to], letter: direction };
    return { folded: [line], creasePattern: [] };
  }, [petal, index, previewing, hovered, petalHinge, picks, liveEnd, direction]);

  return { regions, pending, hovered, onHover };
}
