import type { ExploriDocument } from './document';
import { orientExploriTree, turnExploriTree, type ExploriPaperFrame } from './paperTree';
import { exploriQueryLeafSide, layoutExploriTree } from './treeLayout';
import type { ExploriGraph } from './types';

/**
 * Where a result tree's nodes go on a figure, and whether a mirror line is
 * drawn: the one decision the figure makes, kept React-free so it can be
 * tested on real results.
 *
 * Positions that arrive with the graph are used as they come; a result's
 * `tree` never carries any, and is laid out as a mirror fan (`treeLayout.ts`).
 *
 * Then the paper has its say (`paperTree.ts`). When the pattern mirrors, the
 * fan is built along that mirror — up is along it, and the branch reaching
 * farthest along it keeps the line — and turned to lie on it, and the line is
 * drawn when the tree has a pair to mirror. When the pattern has no mirror but
 * the nodes' positions on it are known, the fan is turned to face the way the
 * tree lies on the paper and no line is drawn. With neither, it leans the way
 * the drawn tree leans.
 */

export interface ExploriDrawnTree {
  positions: Map<string, [number, number]>;
  /** Direction of the mirror line through the origin, or `null` when there is none to draw. */
  axis: [number, number] | null;
}

export function drawExploriTree(
  graph: ExploriGraph,
  query: ExploriDocument | null | undefined,
  paper: ExploriPaperFrame | null | undefined
): ExploriDrawnTree {
  if (graph.nodes.length > 0 && graph.nodes.every((node) => node.pos)) {
    return {
      positions: new Map(graph.nodes.map((node) => [String(node.id), node.pos as [number, number]])),
      axis: null,
    };
  }
  const mirror = paper?.mirror ?? null;
  const positions = paper?.positions ?? null;
  const leafSide = query ? exploriQueryLeafSide(query) : null;
  const fan = layoutExploriTree(graph, {
    ...(leafSide ? { leafSide } : {}),
    ...(positions && mirror ? { paper: { positions, mirror } } : {}),
  });
  if (mirror) {
    return { positions: turnExploriTree(fan.positions, mirror), axis: fan.pairCount > 0 ? mirror : null };
  }
  if (positions) return { positions: orientExploriTree(fan.positions, positions), axis: null };
  return { positions: fan.positions, axis: null };
}
