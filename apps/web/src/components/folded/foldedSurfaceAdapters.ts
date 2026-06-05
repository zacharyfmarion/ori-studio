import type {
  FoldAssignment,
  FoldDocument,
  FoldedBaseSnapshot,
  SequenceStateSnapshot,
} from '../../engine/types';

export function foldedSurfaceFromSequenceState(
  state: SequenceStateSnapshot,
  mode: 'paper' | 'folded' = 'folded'
): FoldedBaseSnapshot {
  const foldedVertices =
    mode === 'folded' && state.folded_vertices.length === state.document.vertices_coords.length
      ? state.folded_vertices
      : state.document.vertices_coords.map(
          (coord) => [coord[0] ?? 0, coord[1] ?? 0] as [number, number]
        );
  return foldedSurfaceFromFoldDocument(
    state.document,
    foldedVertices,
    state.face_orders,
    new Set(state.active_creases)
  );
}

function foldedSurfaceFromFoldDocument(
  document: FoldDocument,
  foldedVertices: Array<[number, number]>,
  faceOrders: Array<[number, number, number]>,
  activeCreases: ReadonlySet<number>
): FoldedBaseSnapshot {
  const borderVertices = borderVertexFlags(document);
  const layerOrder = layerOrderFromFaceOrders(document.faces_vertices.length, faceOrders);
  const vertexCount = Math.max(document.vertices_coords.length, foldedVertices.length);
  const surfaceFacets = surfaceFacetsFromActiveCreases(document, foldedVertices, activeCreases, layerOrder);
  return {
    vertices: Array.from({ length: vertexCount }, (_, index) => {
      const [x, y] = foldedVertices[index] ?? [
        document.vertices_coords[index]?.[0] ?? 0,
        document.vertices_coords[index]?.[1] ?? 0,
      ];
      const paper = document.vertices_coords[index];
      return {
        id: index,
        source_vertex: index,
        loc: { x, y },
        paper_loc: { x: paper?.[0] ?? x, y: paper?.[1] ?? y },
        depth: 0,
        elevation: 0,
        is_border: borderVertices[index] ?? false,
      };
    }),
    creases: document.edges_vertices.map((vertices, index) => ({
      id: index,
      source_crease: index,
      vertices,
      kind: 0,
      fold: foldNumber(assignmentForEdge(document, index)),
    })),
    facets: surfaceFacets,
  };
}

function surfaceFacetsFromActiveCreases(
  document: FoldDocument,
  foldedVertices: Array<[number, number]>,
  activeCreases: ReadonlySet<number>,
  layerOrder: number[]
): FoldedBaseSnapshot['facets'] {
  const faceComponents = surfaceFaceComponents(document, activeCreases);
  const edgeUses = faceEdgeUses(document);
  return faceComponents.flatMap((component, componentIndex) => {
    const componentFaces = new Set(component);
    const loops = boundaryLoopsForComponent(document, componentFaces, edgeUses, activeCreases);
    const sourceFacet = Math.min(...component);
    const color = faceSideColor(document, foldedVertices, document.faces_vertices[sourceFacet] ?? []);
    const order = Math.min(...component.map((face) => layerOrder[face] ?? face));
    return loops.map((vertices, loopIndex) => ({
      id: componentIndex * 1000 + loopIndex,
      source_facet: sourceFacet,
      vertices,
      color,
      order,
    }));
  });
}

function surfaceFaceComponents(
  document: FoldDocument,
  activeCreases: ReadonlySet<number>
): number[][] {
  const faceCount = document.faces_vertices.length;
  const parent = Array.from({ length: faceCount }, (_, index) => index);
  const uses = faceEdgeUses(document);

  uses.forEach((edgeUses) => {
    if (edgeUses.length < 2) return;
    const sourceEdge = edgeUses[0]?.edge;
    if (sourceEdge !== null && edgeIsSurfaceBoundary(document, sourceEdge, activeCreases)) return;
    const firstFace = edgeUses[0]?.face;
    if (firstFace === undefined) return;
    edgeUses.slice(1).forEach((use) => union(parent, firstFace, use.face));
  });

  const components = new Map<number, number[]>();
  for (let face = 0; face < faceCount; face += 1) {
    const root = find(parent, face);
    const component = components.get(root) ?? [];
    component.push(face);
    components.set(root, component);
  }
  return [...components.values()];
}

interface FaceEdgeUse {
  face: number;
  start: number;
  end: number;
  edge: number | null;
}

function faceEdgeUses(document: FoldDocument): Map<string, FaceEdgeUse[]> {
  const sourceEdges = sourceEdgeMap(document);
  const uses = new Map<string, FaceEdgeUse[]>();
  document.faces_vertices.forEach((vertices, face) => {
    for (let index = 0; index < vertices.length; index += 1) {
      const start = vertices[index] ?? 0;
      const end = vertices[(index + 1) % vertices.length] ?? 0;
      const key = edgeKey(start, end);
      const edgeUses = uses.get(key) ?? [];
      edgeUses.push({
        face,
        start,
        end,
        edge: sourceEdges.get(key) ?? null,
      });
      uses.set(key, edgeUses);
    }
  });
  return uses;
}

function sourceEdgeMap(document: FoldDocument): Map<string, number> {
  const map = new Map<string, number>();
  document.edges_vertices.forEach(([a, b], edge) => {
    map.set(edgeKey(a, b), edge);
  });
  return map;
}

function boundaryLoopsForComponent(
  document: FoldDocument,
  componentFaces: ReadonlySet<number>,
  edgeUses: Map<string, FaceEdgeUse[]>,
  activeCreases: ReadonlySet<number>
): number[][] {
  const boundaryEdges: Array<[number, number]> = [];
  edgeUses.forEach((uses) => {
    const componentUses = uses.filter((use) => componentFaces.has(use.face));
    if (componentUses.length === 0) return;
    const sourceEdge = componentUses[0]?.edge;
    const boundary =
      componentUses.length < uses.length ||
      componentUses.length === 1 ||
      (sourceEdge !== null && edgeIsSurfaceBoundary(document, sourceEdge, activeCreases));
    if (!boundary) return;
    componentUses.forEach((use) => boundaryEdges.push([use.start, use.end]));
  });

  const loops = traceBoundaryLoops(boundaryEdges);
  if (loops.length > 0) return loops;

  return [...componentFaces]
    .map((face) => document.faces_vertices[face] ?? [])
    .filter((vertices) => vertices.length >= 3);
}

function traceBoundaryLoops(edges: Array<[number, number]>): number[][] {
  const unused = new Set(edges.map((_, index) => index));
  const byStart = new Map<number, number[]>();
  edges.forEach(([start], index) => {
    const starts = byStart.get(start) ?? [];
    starts.push(index);
    byStart.set(start, starts);
  });

  const loops: number[][] = [];
  while (unused.size > 0) {
    const firstEdge = unused.values().next().value as number | undefined;
    if (firstEdge === undefined) break;
    const [start, firstEnd] = edges[firstEdge] ?? [];
    if (start === undefined || firstEnd === undefined) {
      unused.delete(firstEdge);
      continue;
    }
    unused.delete(firstEdge);
    const loop = [start, firstEnd];
    let current = firstEnd;

    while (current !== start) {
      const nextEdge = byStart.get(current)?.find((candidate) => unused.has(candidate));
      if (nextEdge === undefined) break;
      unused.delete(nextEdge);
      const [, nextEnd] = edges[nextEdge] ?? [];
      if (nextEnd === undefined) break;
      loop.push(nextEnd);
      current = nextEnd;
    }

    if (loop.length >= 4 && loop[loop.length - 1] === start) {
      loops.push(loop.slice(0, -1));
    }
  }
  return loops.filter((loop) => loop.length >= 3);
}

function edgeIsSurfaceBoundary(
  document: FoldDocument,
  edge: number,
  activeCreases: ReadonlySet<number>
): boolean {
  return activeCreases.has(edge) || assignmentForEdge(document, edge) === 'B';
}

function edgeKey(a: number, b: number): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

function find(parent: number[], value: number): number {
  let root = value;
  while (parent[root] !== root) root = parent[root] ?? root;
  while (parent[value] !== value) {
    const next = parent[value] ?? value;
    parent[value] = root;
    value = next;
  }
  return root;
}

function union(parent: number[], a: number, b: number) {
  const rootA = find(parent, a);
  const rootB = find(parent, b);
  if (rootA !== rootB) parent[rootB] = rootA;
}

function faceSideColor(
  document: FoldDocument,
  foldedVertices: Array<[number, number]>,
  face: number[]
): number {
  const paperArea = signedFaceArea(face, (vertex) => {
    const coords = document.vertices_coords[vertex];
    return [coords?.[0] ?? 0, coords?.[1] ?? 0];
  });
  const foldedArea = signedFaceArea(face, (vertex) => foldedVertices[vertex] ?? [0, 0]);
  if (Math.abs(paperArea) < 1e-9 || Math.abs(foldedArea) < 1e-9) return 1;
  return Math.sign(paperArea) === Math.sign(foldedArea) ? 1 : 2;
}

function signedFaceArea(
  face: number[],
  pointForVertex: (vertex: number) => [number, number]
): number {
  let area = 0;
  for (let index = 0; index < face.length; index += 1) {
    const [x1, y1] = pointForVertex(face[index] ?? 0);
    const [x2, y2] = pointForVertex(face[(index + 1) % face.length] ?? 0);
    area += x1 * y2 - x2 * y1;
  }
  return area / 2;
}

function borderVertexFlags(document: FoldDocument): boolean[] {
  const flags = new Array(document.vertices_coords.length).fill(false) as boolean[];
  document.edges_vertices.forEach(([a, b], edge) => {
    if (assignmentForEdge(document, edge) !== 'B') return;
    if (a >= 0 && a < flags.length) flags[a] = true;
    if (b >= 0 && b < flags.length) flags[b] = true;
  });
  return flags;
}

function layerOrderFromFaceOrders(
  faceCount: number,
  faceOrders: Array<[number, number, number]>
): number[] {
  const scores = new Array(faceCount).fill(0) as number[];
  faceOrders.forEach(([above, below]) => {
    if (Number.isInteger(above) && above >= 0 && above < scores.length) scores[above] += 1;
    if (Number.isInteger(below) && below >= 0 && below < scores.length) scores[below] -= 1;
  });
  const faces = Array.from({ length: faceCount }, (_, face) => face);
  faces.sort((a, b) => scores[a] - scores[b] || a - b);
  const order = new Array(faceCount).fill(0) as number[];
  faces.forEach((face, rank) => {
    order[face] = rank;
  });
  return order;
}

function foldNumber(assignment: FoldAssignment): number {
  switch (assignment) {
    case 'M':
      return 1;
    case 'V':
      return 2;
    case 'B':
      return 3;
    case 'F':
    case 'U':
    case 'C':
    case 'J':
      return 0;
  }
}

function assignmentForEdge(document: FoldDocument, edge: number): FoldAssignment {
  return document.edges_assignment?.[edge] ?? 'U';
}
