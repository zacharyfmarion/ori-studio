import type { OristudioBpRiver } from '../engine/oristudioBpTypes';

/**
 * The river a piece of packing geometry belongs to, or null when it belongs to
 * something else.
 *
 * The engine names a river node's graphics after its dual tree edge —
 * `re{n1},{n2}` — and everything derived from that node keeps the name as a
 * prefix, so `re3,4:contour:0` and `re3,4:ridge:2` both answer "river between
 * vertices 3 and 4". A flap's is `f{id}`, which this rejects.
 *
 * The edge is undirected, so the pair is matched either way round: the id
 * carries the engine's vertex order, which need not be the snapshot's.
 */
export function bpRiverIdFromGraphicsId(
  id: string,
  rivers: readonly OristudioBpRiver[],
): number | null {
  const match = /^re(\d+),(\d+)(?::|$)/.exec(id);
  if (!match) return null;
  const first = Number.parseInt(match[1], 10);
  const second = Number.parseInt(match[2], 10);
  const river = rivers.find((candidate) => {
    const [a, b] = candidate.vertices;
    return (a === first && b === second) || (a === second && b === first);
  });
  return river?.id ?? null;
}
