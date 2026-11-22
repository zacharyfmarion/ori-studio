/**
 * How two stored scenes of one step differ, for the diagram corpus report.
 * Test-only.
 *
 * Stored scenes are snapped to a fixed step (`storedSceneStep`), so a number
 * a change nudged by a hair can land one step over. That is not a change
 * anyone can see, and the report must not list it. In order of what is
 * checked:
 *
 * 1. `same`: the same items, in the same order, exactly.
 * 2. `items`: the counts per kind, role and side differ.
 * 3. `rounding`: the same items in the same order, every coordinate within
 *    one snap step and every other field exact.
 * 4. `order`: the same items (within a snap step) in another order. A
 *    picture can look identical and still be wrong this way: a buried line
 *    drawn last is drawn on top (90591a0ca).
 * 5. `geometry`: the same counts, but some items moved or changed.
 */
import type { PaperItem, PaperScene } from '@treemaker/origami-simulator';
import { storedSceneStep } from '../capture/captureGeometry';
import { digest } from '../pictures/pictureKey';

export type SceneChange =
  | { kind: 'same' }
  | { kind: 'items'; before: Record<string, number>; after: Record<string, number> }
  | { kind: 'rounding' }
  | { kind: 'order' }
  | { kind: 'geometry'; unmatched: number };

/** What an item is, for counting: `face:front`, `line:aux`, … */
export function itemLabel(item: PaperItem): string {
  if (item.kind === 'face') return `face:${item.side}`;
  if (item.kind === 'line') return `line:${item.role}`;
  return item.kind;
}

export function sceneCounts(scene: PaperScene): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of scene.items) {
    const label = itemLabel(item);
    counts[label] = (counts[label] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
}

/** A digest of the scene's items in no particular order: equal for the same items drawn in another order. */
export function orderFreeDigest(scene: PaperScene): string {
  return digest(
    scene.items
      .map((item) => JSON.stringify(item))
      .sort()
      .join('\n')
  );
}

type Point = readonly [number, number];

function pointsOf(item: PaperItem): Point[] {
  if (item.kind === 'face') return item.rings.flat() as Point[];
  if (item.kind === 'line') {
    const whole = item.whole ? [item.whole.a, item.whole.b] : [];
    return [item.a, item.b, ...whole] as Point[];
  }
  return [];
}

/** The item with every coordinate taken out, for comparing everything else exactly. */
function withoutPoints(item: PaperItem): string {
  if (item.kind === 'face') {
    const { rings, ...rest } = item;
    return JSON.stringify({ ...rest, rings: rings.map((ring) => ring.length) });
  }
  if (item.kind === 'line') {
    const { a: _a, b: _b, whole, ...rest } = item;
    return JSON.stringify({ ...rest, whole: whole ? { ...whole, a: null, b: null } : null });
  }
  return JSON.stringify(item);
}

function within(a: PaperItem, b: PaperItem, tolerance: number): boolean {
  if (a.kind !== b.kind || withoutPoints(a) !== withoutPoints(b)) return false;
  const pa = pointsOf(a);
  const pb = pointsOf(b);
  if (pa.length !== pb.length) return false;
  for (let index = 0; index < pa.length; index += 1) {
    if (Math.abs(pa[index]![0] - pb[index]![0]) > tolerance) return false;
    if (Math.abs(pa[index]![1] - pb[index]![1]) > tolerance) return false;
  }
  return true;
}

/** Items of `after` matched to `before`'s within `tolerance`, whatever their order; how many found no match. */
function unmatchedIgnoringOrder(before: readonly PaperItem[], after: readonly PaperItem[], tolerance: number): number {
  // Bucketed by label and a coarse cell of the first point, searching the
  // neighbouring cells too, so a point snapped across a cell edge is found.
  const cell = Math.max(tolerance * 16, 1e-6);
  const cellOf = (item: PaperItem): [number, number] => {
    const first = pointsOf(item)[0] ?? [0, 0];
    return [Math.floor(first[0] / cell), Math.floor(first[1] / cell)];
  };
  const buckets = new Map<string, PaperItem[]>();
  for (const item of after) {
    const [cx, cy] = cellOf(item);
    const key = `${itemLabel(item)}|${cx}|${cy}`;
    let bucket = buckets.get(key);
    if (!bucket) buckets.set(key, (bucket = []));
    bucket.push(item);
  }
  let unmatched = 0;
  for (const item of before) {
    const [cx, cy] = cellOf(item);
    let found = false;
    for (let dx = -1; dx <= 1 && !found; dx += 1) {
      for (let dy = -1; dy <= 1 && !found; dy += 1) {
        const bucket = buckets.get(`${itemLabel(item)}|${cx + dx}|${cy + dy}`);
        const at = bucket?.findIndex((candidate) => within(item, candidate, tolerance)) ?? -1;
        if (bucket && at >= 0) {
          bucket.splice(at, 1);
          found = true;
        }
      }
    }
    if (!found) unmatched += 1;
  }
  return unmatched;
}

export function compareScenes(before: PaperScene, after: PaperScene): SceneChange {
  const a = before.items;
  const b = after.items;
  if (a.length === b.length && a.every((item, index) => JSON.stringify(item) === JSON.stringify(b[index]))) {
    return { kind: 'same' };
  }
  const countsBefore = sceneCounts(before);
  const countsAfter = sceneCounts(after);
  if (JSON.stringify(countsBefore) !== JSON.stringify(countsAfter)) {
    return { kind: 'items', before: countsBefore, after: countsAfter };
  }
  // One snap step, and a hair over for the division's own rounding.
  const tolerance = Math.max(storedSceneStep(before.sheet), storedSceneStep(after.sheet)) * 1.001;
  if (a.every((item, index) => within(item, b[index]!, tolerance))) return { kind: 'rounding' };
  const unmatched = unmatchedIgnoringOrder(a, b, tolerance);
  return unmatched === 0 ? { kind: 'order' } : { kind: 'geometry', unmatched };
}
