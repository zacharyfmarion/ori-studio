import type { Point } from '../lib/geometry';
import type { EditableTree, EditableTreeEdge, EditableTreeVertex } from '../tree-editor/model';
import type { TreeSymmetryPair } from '../tree-editor/host';
import type { ExploriDbConfig, ExploriResult, ExploriSymmetry } from './types';
import { EXPLORI_SIZES, EXPLORI_SYMMETRIES } from './types';
import { EXPLORI_SYMMETRY_TOLERANCE } from './symmetry';

/**
 * What an ExplOri design *is*, and what a saved one holds.
 *
 * The split here is the load-bearing decision. The document holds what the user
 * authored — the tree, the query settings, the mirror pairs — plus, for the
 * result they picked, its identity **and a copy of its geometry**. The rest of a
 * result list lives in a session cache and is never written to a file.
 *
 * Why not store every result: the archive is not versioned and can change under
 * us, so a design whose meaning depends on re-running a query is a design that
 * can silently become a different design. Storing the chosen result makes a
 * saved file reproducible offline and forever, at about 8 KB. Storing the whole
 * list would put a hundred KB of other people's tilings into every save, for
 * results the user did not pick.
 */

export interface ExploriTreeNode {
  id: number;
  loc: Point;
  name: string;
}

export interface ExploriTreeEdge {
  id: number;
  /** Parent first. The tree is rooted at node 0. */
  vertices: [number, number];
  length: number;
}

export interface ExploriDocument {
  /** Schema of this document's own JSON, independent of the `.osf` version. */
  version: 1;
  nodes: ExploriTreeNode[];
  edges: ExploriTreeEdge[];
  nextNodeId: number;
  nextEdgeId: number;
  dbConfigs: ExploriDbConfig[];
  /**
   * Whether the user has chosen the databases themselves.
   *
   * Until they do, the selection follows the drawing — see
   * {@link effectiveExploriDbConfigs}. Once they have, it is theirs and nothing
   * about the tree may move it.
   */
  dbConfigsDirty: boolean;
  resultLimit: number;
  symmetry: { enabled: boolean; pairs: TreeSymmetryPair[] };
  /** The result the user picked, kept whole so it works with the network down. */
  selected: ExploriResult | null;
}

/**
 * Databases a new design searches: **everything**, as upstream's own defaults do
 * (every checkbox in its advanced table ships checked).
 *
 * It also keeps the query bar honest. A symmetry toggle reads "on" when any size
 * of it is selected, so a default of one size would show three lit toggles over
 * a search that was quietly narrower than it looked.
 */
export const DEFAULT_DB_CONFIGS: ExploriDbConfig[] = EXPLORI_SIZES.flatMap((N) =>
  EXPLORI_SYMMETRIES.map((symmetry) => ({ N, symmetry }))
);

export const DEFAULT_RESULT_LIMIT = 8;

/**
 * A fresh design: one root node, nothing else.
 *
 * Empty rather than a starter tree, because the tree is the whole question the
 * user is here to ask and any tree we invent is a wrong answer to it.
 */
export function createExploriDocument(): ExploriDocument {
  return {
    version: 1,
    nodes: [{ id: 0, loc: { x: 0, y: 0 }, name: '' }],
    edges: [],
    nextNodeId: 1,
    nextEdgeId: 1,
    dbConfigs: [...DEFAULT_DB_CONFIGS],
    dbConfigsDirty: false,
    resultLimit: DEFAULT_RESULT_LIMIT,
    // Trees drawn for search are nearly always symmetric, and the book
    // databases are the ones people reach for, so mirror draw starts on — as it
    // does on box-pleat.
    symmetry: { enabled: true, pairs: [] },
    selected: null,
  };
}

/** Degree of each node, which is what makes a node a leaf. */
function degrees(document: ExploriDocument): Map<number, number> {
  const counts = new Map<number, number>(document.nodes.map((node) => [node.id, 0]));
  for (const edge of document.edges) {
    counts.set(edge.vertices[0], (counts.get(edge.vertices[0]) ?? 0) + 1);
    counts.set(edge.vertices[1], (counts.get(edge.vertices[1]) ?? 0) + 1);
  }
  return counts;
}

/**
 * The document as the tree editor sees it.
 *
 * A leaf is a node of degree one — and the root counts, once it has a single
 * child, because a two-node tree is one flap hanging off another rather than a
 * flap hanging off nothing.
 */
export function exploriEditableTree(document: ExploriDocument): EditableTree {
  const counts = degrees(document);
  const vertices: EditableTreeVertex[] = document.nodes.map((node) => ({
    id: node.id,
    loc: node.loc,
    isLeaf: (counts.get(node.id) ?? 0) <= 1,
    isRoot: node.id === 0,
    name: node.name,
  }));
  const leafIds = new Set(vertices.filter((vertex) => vertex.isLeaf).map((vertex) => vertex.id));
  const edges: EditableTreeEdge[] = document.edges.map((edge) => ({
    id: edge.id,
    vertices: edge.vertices,
    length: edge.length,
    isLeafEdge: leafIds.has(edge.vertices[0]) || leafIds.has(edge.vertices[1]),
    // No ceiling: an ExplOri tree is a schematic with no paper to overflow.
    maxLength: null,
  }));
  return { rootVertexId: 0, vertices, edges };
}

/** Length of an edge, from the drawing. The geometry *is* the length here. */
export function exploriEdgeLength(document: ExploriDocument, edge: ExploriTreeEdge): number {
  const a = document.nodes.find((node) => node.id === edge.vertices[0]);
  const b = document.nodes.find((node) => node.id === edge.vertices[1]);
  if (!a || !b) return edge.length;
  return Math.hypot(a.loc.x - b.loc.x, a.loc.y - b.loc.y);
}

/**
 * Whether the drawing is symmetric about the mirror.
 *
 * Every node either sits on the axis or has one at its reflection. Asked of the
 * *geometry* rather than of the pairing, because a tree drawn symmetrically by
 * hand — with mirror draw off, or loaded from a file — is symmetric whether or
 * not anything recorded it as paired.
 */
export function exploriTreeIsSymmetric(
  document: ExploriDocument,
  tolerance = EXPLORI_SYMMETRY_TOLERANCE
): boolean {
  if (document.nodes.length === 0) return true;
  return document.nodes.every((node) => {
    if (Math.abs(node.loc.x) <= tolerance) return true;
    return document.nodes.some(
      (other) =>
        other.id !== node.id &&
        Math.abs(other.loc.x + node.loc.x) <= tolerance &&
        Math.abs(other.loc.y - node.loc.y) <= tolerance
    );
  });
}

/**
 * The databases a search actually uses.
 *
 * Until the user picks for themselves, this follows the drawing: a symmetric
 * tree has no business searching the asymmetric archive, and an asymmetric one
 * needs it. Searching everything by default made every symmetric query — which
 * is most of them — spend a third of its results on tilings that could not match.
 *
 * The moment the user touches the selection it is theirs and this stops
 * guessing, which is what `dbConfigsDirty` records.
 */
export function effectiveExploriDbConfigs(document: ExploriDocument): ExploriDbConfig[] {
  if (document.dbConfigsDirty) return document.dbConfigs;
  const symmetries: ExploriSymmetry[] = exploriTreeIsSymmetric(document)
    ? ['diag', 'book']
    : [...EXPLORI_SYMMETRIES];
  return EXPLORI_SIZES.flatMap((N) => symmetries.map((symmetry) => ({ N, symmetry })));
}

export function serializeExploriDocument(document: ExploriDocument): string {
  return JSON.stringify(document);
}

function isFinitePoint(value: unknown): value is Point {
  if (!value || typeof value !== 'object') return false;
  const point = value as Record<string, unknown>;
  return (
    typeof point.x === 'number' &&
    typeof point.y === 'number' &&
    Number.isFinite(point.x) &&
    Number.isFinite(point.y)
  );
}

/**
 * Read a document back.
 *
 * Lenient in the house style of the `nativeProjectFile` validators: anything
 * unusable is dropped rather than thrown, so a hand-edited or truncated design
 * still opens. A document that yields no nodes at all falls back to a fresh one
 * — a tree editor with nothing to hang a leaf from is not a state worth having.
 */
export function parseExploriDocument(text: string): ExploriDocument {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return createExploriDocument();
  }
  if (!raw || typeof raw !== 'object') return createExploriDocument();
  const record = raw as Record<string, unknown>;
  const fallback = createExploriDocument();

  const nodes: ExploriTreeNode[] = [];
  if (Array.isArray(record.nodes)) {
    for (const entry of record.nodes) {
      if (!entry || typeof entry !== 'object') continue;
      const node = entry as Record<string, unknown>;
      if (typeof node.id !== 'number' || !Number.isInteger(node.id)) continue;
      if (!isFinitePoint(node.loc)) continue;
      nodes.push({
        id: node.id,
        loc: { x: node.loc.x, y: node.loc.y },
        name: typeof node.name === 'string' ? node.name : '',
      });
    }
  }
  if (nodes.length === 0) return fallback;

  const nodeIds = new Set(nodes.map((node) => node.id));
  const edges: ExploriTreeEdge[] = [];
  if (Array.isArray(record.edges)) {
    for (const entry of record.edges) {
      if (!entry || typeof entry !== 'object') continue;
      const edge = entry as Record<string, unknown>;
      const pair = edge.vertices;
      if (!Array.isArray(pair) || pair.length < 2) continue;
      const [u, v] = pair as unknown[];
      if (typeof u !== 'number' || typeof v !== 'number') continue;
      if (!nodeIds.has(u) || !nodeIds.has(v) || u === v) continue;
      const length = typeof edge.length === 'number' && edge.length > 0 ? edge.length : 1;
      edges.push({
        id: typeof edge.id === 'number' ? edge.id : edges.length + 1,
        vertices: [u, v],
        length,
      });
    }
  }

  const dbConfigs: ExploriDbConfig[] = [];
  if (Array.isArray(record.dbConfigs)) {
    for (const entry of record.dbConfigs) {
      if (!entry || typeof entry !== 'object') continue;
      const config = entry as Record<string, unknown>;
      if (typeof config.N !== 'number' || !Number.isInteger(config.N)) continue;
      if (!EXPLORI_SYMMETRIES.includes(config.symmetry as ExploriSymmetry)) continue;
      dbConfigs.push({ N: config.N, symmetry: config.symmetry as ExploriSymmetry });
    }
  }

  const symmetry = record.symmetry as Record<string, unknown> | undefined;
  const pairs: TreeSymmetryPair[] = [];
  if (symmetry && Array.isArray(symmetry.pairs)) {
    for (const entry of symmetry.pairs) {
      if (!entry || typeof entry !== 'object') continue;
      const pair = entry as Record<string, unknown>;
      if (typeof pair.v1 !== 'number' || typeof pair.v2 !== 'number') continue;
      if (!nodeIds.has(pair.v1) || !nodeIds.has(pair.v2) || pair.v1 === pair.v2) continue;
      pairs.push({ v1: Math.min(pair.v1, pair.v2), v2: Math.max(pair.v1, pair.v2) });
    }
  }

  return {
    version: 1,
    nodes,
    edges,
    nextNodeId: Math.max(...nodes.map((node) => node.id)) + 1,
    nextEdgeId: edges.reduce((highest, edge) => Math.max(highest, edge.id), 0) + 1,
    dbConfigs: dbConfigs.length > 0 ? dbConfigs : fallback.dbConfigs,
    dbConfigsDirty: record.dbConfigsDirty === true,
    resultLimit:
      typeof record.resultLimit === 'number' && record.resultLimit > 0
        ? Math.min(50, Math.round(record.resultLimit))
        : fallback.resultLimit,
    symmetry: {
      enabled: typeof symmetry?.enabled === 'boolean' ? symmetry.enabled : true,
      pairs,
    },
    // Trusted as-is when present: it is our own serialization of a validated
    // response, and re-validating it here would duplicate `exploriService`.
    selected: (record.selected as ExploriResult | null) ?? null,
  };
}
