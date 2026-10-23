/**
 * Where a swivel by its valley and mountain's creases meet, once its valley
 * is taken: where the valley crosses a folded edge the folded pane shows. The
 * mountain runs from there, and the engine takes the pair only when the two
 * lines meet on a folded edge (`compound/swivel_valley_mountain.rs`). That
 * point is seldom a landmark — the valley is often constructed, by an axiom —
 * so no click could land on it exactly; while the mountain's points are
 * clicked, a click near it takes the crossing itself, and the pane marks it.
 *
 * Pure: no React, no store, no engine. Asked once a frame under a moving
 * pointer, so each index's meetings are worked out once per valley.
 */
import type { Point } from '../../../lib/geometry';
import type { FoldModelLine } from '../../document/foldSequenceDocument';
import type { FoldStepSnap } from '../../tools/foldToolRegistry';
import type { FoldToolState } from '../../tools/foldToolState';
import { nearestOnSegment, sideOf } from '../foldCanvasGeometry';
import type { FoldOverlayInks, FoldOverlayMarks } from '../foldPaneOverlays';
import type { FoldPaneId, FoldPick, FoldPickIndex, FoldPointPick } from '../foldPicking';

/** A meeting point: the pick a click there takes, and where the folded pane draws it. */
export interface FoldSwivelMeeting {
  pick: FoldPointPick;
  drawn: Point;
}

/** How far inside a folded edge's ends a meeting lies: the engine meets the lines strictly inside a bend. */
const END_MARGIN = 1e-3;
/** How far off a shown stretch of its edge, in the pane's frame, a meeting still lies on it. */
const ON_PORTION = 1e-7;
/** CSS px: the meeting's dot, as a vertex fold's vertex is drawn (`vertexOverlay`). */
const MEETING_RADIUS = 4;

const cache = new WeakMap<FoldPickIndex, { valley: FoldModelLine; meetings: readonly FoldSwivelMeeting[] }>();

/** Where `valley` (in the scene frame) crosses each folded edge the folded pane shows, strictly inside its ends. */
export function swivelMeetings(index: FoldPickIndex, valley: FoldModelLine): readonly FoldSwivelMeeting[] {
  const held = cache.get(index);
  if (held?.valley === valley) return held.meetings;
  const { segments, portions } = index.folded;
  const meetings: FoldSwivelMeeting[] = [];
  segments.forEach((segment, k) => {
    if (segment.segment !== 'bend') return;
    const [a, b] = segment.scene;
    const sa = sideOf(valley, a);
    const sb = sideOf(valley, b);
    if (sa === sb) return;
    const t = sa / (sa - sb);
    if (!(t > END_MARGIN && t < 1 - END_MARGIN)) return;
    const [p, q] = segment.sheet;
    const scene = { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) };
    const sheet: [number, number] = [p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1])];
    const drawn = (index.spread && index.spread.sheet(sheet)) ?? scene;
    // Only where the viewer sees the folded edge: a meeting hidden under a layer is no point to click.
    const shown = (portions[k] ?? []).some(([from, to]) => {
      const near = nearestOnSegment(drawn, from, to);
      return Math.hypot(near.x - drawn.x, near.y - drawn.y) <= ON_PORTION;
    });
    if (!shown) return;
    meetings.push({ pick: { kind: 'point', pane: 'folded', provenance: 'fold', sheet, mark: null, scene }, drawn });
  });
  cache.set(index, { valley, meetings });
  return meetings;
}

/**
 * What a click at `at` on `pane` takes in a meeting point's place: the
 * nearest meeting within `radius`, as the click's step takes a point — a
 * reference for an axiom, a free line's end for a line through two points;
 * null off the folded pane, beyond reach, or for a click that takes a line.
 */
export function swivelMeetingPick(
  meetings: readonly FoldSwivelMeeting[],
  pane: FoldPaneId,
  at: Point,
  radius: number,
  snap: FoldStepSnap
): FoldPick | null {
  if (pane !== 'folded' || snap === 'crease-required') return null;
  let best: FoldSwivelMeeting | null = null;
  let bestDistance = radius;
  for (const meeting of meetings) {
    const distance = Math.hypot(meeting.drawn.x - at.x, meeting.drawn.y - at.y);
    if (distance <= bestDistance) {
      best = meeting;
      bestDistance = distance;
    }
  }
  if (!best) return null;
  const { pick } = best;
  return snap === 'free' && pick.scene ? { kind: 'free', pane, scene: pick.scene, sheet: pick.sheet } : pick;
}

/**
 * The meeting points' dots over the folded pane, where it draws them, in the
 * pick accent: while a swivel by its valley and mountain's mountain is
 * located, its valley taken. Null for any other tool, and with none shown.
 */
export function swivelMeetingMarks(
  index: FoldPickIndex | null,
  tools: Pick<FoldToolState, 'tool' | 'takenLine'>,
  inks: Pick<FoldOverlayInks, 'accent' | 'outline'> | null
): FoldOverlayMarks | null {
  const valley = tools.tool === 'swivel' ? tools.takenLine : undefined;
  const meetings = index && valley && inks ? swivelMeetings(index, valley.sceneLine) : [];
  if (!inks || meetings.length === 0) return null;
  return {
    dots: meetings.map(({ drawn }) => ({ at: drawn, radius: MEETING_RADIUS, fill: inks.accent, stroke: inks.outline })),
    strokes: [],
  };
}
