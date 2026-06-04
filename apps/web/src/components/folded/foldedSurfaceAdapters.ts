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
  return foldedSurfaceFromFoldDocument(state.document, foldedVertices, state.face_orders);
}

function foldedSurfaceFromFoldDocument(
  document: FoldDocument,
  foldedVertices: Array<[number, number]>,
  faceOrders: Array<[number, number, number]>
): FoldedBaseSnapshot {
  const borderVertices = borderVertexFlags(document);
  const layerOrder = layerOrderFromFaceOrders(document.faces_vertices.length, faceOrders);
  const vertexCount = Math.max(document.vertices_coords.length, foldedVertices.length);
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
    facets: document.faces_vertices.map((vertices, index) => ({
      id: index,
      source_facet: index,
      vertices,
      color: index % 2 === 0 ? 1 : 2,
      order: layerOrder[index] ?? index,
    })),
  };
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
