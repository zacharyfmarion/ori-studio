import earcut from 'earcut';
import {
  assignmentFoldAngle,
  buildEdgeIndex,
  cloneFold,
  edgeKey,
  facePairs,
  normalizeAssignment,
  normalizePoint,
} from './geometry.js';
import type {
  CreaseParameter,
  FoldAssignment,
  FoldDocument,
  PreparedOrigamiModel,
  PrepareFoldOptions,
  SimulatorDiagnostics,
} from './types.js';

export function prepareFoldModel(
  source: FoldDocument,
  options: PrepareFoldOptions = {}
): PreparedOrigamiModel {
  const diagnostics: SimulatorDiagnostics = { warnings: [], errors: [] };
  validateFold(source, diagnostics);
  if (diagnostics.errors.length) {
    throw new Error(diagnostics.errors.join('; '));
  }

  const fold = normalizeFold(source, options, diagnostics);
  const vertexCount = fold.vertices_coords.length;
  const positions = new Float32Array(vertexCount * 3);
  fold.vertices_coords.forEach((coord, index) => {
    positions.set(normalizePoint(coord), index * 3);
  });

  const indices = new Uint32Array(fold.faces_vertices.length * 3);
  fold.faces_vertices.forEach((face, index) => {
    indices.set(face.slice(0, 3), index * 3);
  });

  const colors = new Float32Array(vertexCount * 3);
  colors.fill(0.8);

  const facesEdges = buildFacesEdges(fold, diagnostics);
  const edgesFaces = buildEdgesFaces(fold, facesEdges, diagnostics);
  const creaseParams = buildCreaseParams(fold, edgesFaces);

  return {
    fold: { ...fold, faces_edges: facesEdges, edges_faces: edgesFaces },
    vertexCount,
    edgeCount: fold.edges_vertices.length,
    faceCount: fold.faces_vertices.length,
    positions: positions.slice(),
    originalPositions: positions,
    colors,
    indices,
    edgesVertices: fold.edges_vertices,
    edgesAssignment: fold.edges_assignment ?? [],
    edgesFoldAngle: fold.edges_foldAngle ?? [],
    facesVertices: fold.faces_vertices,
    facesEdges,
    edgesFaces,
    creaseParams,
    diagnostics,
  };
}

function validateFold(fold: FoldDocument, diagnostics: SimulatorDiagnostics): void {
  if (!fold.vertices_coords?.length) diagnostics.errors.push('FOLD document has no vertices');
  if (!fold.edges_vertices?.length) diagnostics.errors.push('FOLD document has no edges');
  if (!fold.faces_vertices?.length) diagnostics.errors.push('FOLD document has no faces');

  const vertexCount = fold.vertices_coords?.length ?? 0;
  fold.edges_vertices?.forEach((edge, index) => {
    if (edge.length !== 2) diagnostics.errors.push(`edge ${index} must have two vertices`);
    if (edge.some((vertex) => vertex < 0 || vertex >= vertexCount)) {
      diagnostics.errors.push(`edge ${index} references an invalid vertex`);
    }
  });
  fold.faces_vertices?.forEach((face, index) => {
    if (face.length < 3) diagnostics.errors.push(`face ${index} must have at least three vertices`);
    if (face.some((vertex) => vertex < 0 || vertex >= vertexCount)) {
      diagnostics.errors.push(`face ${index} references an invalid vertex`);
    }
  });
}

function normalizeFold(
  source: FoldDocument,
  options: PrepareFoldOptions,
  diagnostics: SimulatorDiagnostics
): FoldDocument {
  const fold = cloneFold(source);
  fold.vertices_coords = fold.vertices_coords.map((coord) => normalizePoint(coord));
  fold.edges_assignment = fold.edges_vertices.map((_, index) =>
    normalizeAssignment(fold.edges_assignment?.[index])
  );
  fold.edges_foldAngle = fold.edges_vertices.map((_, index) => {
    const assignment = fold.edges_assignment?.[index] ?? 'U';
    const angle = fold.edges_foldAngle?.[index];
    if (typeof angle === 'number' || angle === null) return angle;
    return options.foldUseAngles === false ? assignmentFoldAngle(assignment) : assignmentFoldAngle(assignment);
  });

  if (options.triangulate ?? true) {
    triangulateFold(fold, diagnostics);
  }

  return fold;
}

function triangulateFold(fold: FoldDocument, diagnostics: SimulatorDiagnostics): void {
  // One O(edges) index, kept in sync as triangulation appends diagonal edges, so
  // every dedup below is O(1) instead of a linear `findEdge` scan.
  const edgeIndex = buildEdgeIndex(fold.edges_vertices);
  const nextFaces: number[][] = [];
  const originalFaceCount = fold.faces_vertices.length;
  for (let faceIndex = 0; faceIndex < originalFaceCount; faceIndex += 1) {
    const face = fold.faces_vertices[faceIndex] ?? [];
    if (face.length === 3) {
      nextFaces.push(face);
      continue;
    }
    if (face.length === 4) {
      triangulateQuad(fold, face, nextFaces, edgeIndex);
      continue;
    }

    const coords: number[] = [];
    for (const vertex of face) {
      const coord = fold.vertices_coords[vertex] ?? [0, 0, 0];
      coords.push(coord[0] ?? 0, coord[2] ?? coord[1] ?? 0);
    }
    const triangles = earcut(coords, undefined, 2);
    if (triangles.length < 3) {
      diagnostics.warnings.push(`face ${faceIndex} could not be triangulated`);
      continue;
    }
    for (let i = 0; i < triangles.length; i += 3) {
      nextFaces.push([
        face[triangles[i] ?? 0] ?? 0,
        face[triangles[i + 1] ?? 0] ?? 0,
        face[triangles[i + 2] ?? 0] ?? 0,
      ]);
    }
  }

  fold.faces_vertices = nextFaces;
  for (const face of nextFaces) {
    for (const [a, b] of facePairs(face)) {
      appendEdgeIfMissing(fold, edgeIndex, a, b);
    }
  }
}

function triangulateQuad(
  fold: FoldDocument,
  face: number[],
  nextFaces: number[][],
  edgeIndex: Map<number, number>
): void {
  const d1 = pointDistanceSq(fold, face[0] ?? 0, face[2] ?? 0);
  const d2 = pointDistanceSq(fold, face[1] ?? 0, face[3] ?? 0);
  if (d2 < d1) {
    appendEdgeIfMissing(fold, edgeIndex, face[1] ?? 0, face[3] ?? 0);
    nextFaces.push([face[0] ?? 0, face[1] ?? 0, face[3] ?? 0]);
    nextFaces.push([face[1] ?? 0, face[2] ?? 0, face[3] ?? 0]);
  } else {
    appendEdgeIfMissing(fold, edgeIndex, face[0] ?? 0, face[2] ?? 0);
    nextFaces.push([face[0] ?? 0, face[1] ?? 0, face[2] ?? 0]);
    nextFaces.push([face[0] ?? 0, face[2] ?? 0, face[3] ?? 0]);
  }
}

// Append an edge only if it isn't already present, keeping `edgeIndex` in sync so
// subsequent lookups (and appends) stay O(1). Replaces the old linear-scan dedup.
function appendEdgeIfMissing(
  fold: FoldDocument,
  edgeIndex: Map<number, number>,
  a: number,
  b: number
): void {
  const key = edgeKey(a, b);
  if (edgeIndex.has(key)) return;
  edgeIndex.set(key, fold.edges_vertices.length);
  fold.edges_vertices.push([a, b]);
  fold.edges_assignment?.push('F');
  fold.edges_foldAngle?.push(0);
}

function pointDistanceSq(fold: FoldDocument, a: number, b: number): number {
  const ca = fold.vertices_coords[a] ?? [0, 0, 0];
  const cb = fold.vertices_coords[b] ?? [0, 0, 0];
  const dx = (ca[0] ?? 0) - (cb[0] ?? 0);
  const dz = (ca[2] ?? ca[1] ?? 0) - (cb[2] ?? cb[1] ?? 0);
  return dx * dx + dz * dz;
}

function buildFacesEdges(fold: FoldDocument, diagnostics: SimulatorDiagnostics): number[][] {
  // Build the edge lookup once (O(edges)) and hit it O(1) per face-edge, instead
  // of a linear `findEdge` scan per face-edge (which was O(faces × edges)).
  const edgeIndex = buildEdgeIndex(fold.edges_vertices);
  return fold.faces_vertices.map((face, faceIndex) =>
    facePairs(face).map(([a, b]) => {
      const edge = edgeIndex.get(edgeKey(a, b)) ?? -1;
      if (edge === -1) {
        diagnostics.warnings.push(`face ${faceIndex} references missing edge ${a}-${b}`);
      }
      return edge;
    })
  );
}

function buildEdgesFaces(
  fold: FoldDocument,
  facesEdges: number[][],
  diagnostics: SimulatorDiagnostics
): number[][] {
  const edgesFaces = fold.edges_vertices.map((): number[] => []);
  facesEdges.forEach((faceEdges, faceIndex) => {
    faceEdges.forEach((edge) => {
      if (edge < 0) return;
      edgesFaces[edge]?.push(faceIndex);
      if ((edgesFaces[edge]?.length ?? 0) > 2) {
        diagnostics.warnings.push(`edge ${edge} is incident to more than two faces`);
      }
    });
  });
  return edgesFaces;
}

function buildCreaseParams(fold: FoldDocument, edgesFaces: number[][]): CreaseParameter[] {
  const params: CreaseParameter[] = [];
  fold.edges_vertices.forEach((edge, edgeIndex) => {
    const assignment: FoldAssignment = fold.edges_assignment?.[edgeIndex] ?? 'U';
    const angle = fold.edges_foldAngle?.[edgeIndex] ?? assignmentFoldAngle(assignment);
    if ((assignment !== 'M' && assignment !== 'V' && assignment !== 'F') || angle === null) return;

    const faces = edgesFaces[edgeIndex] ?? [];
    if (faces.length !== 2) return;
    let face1Index = faces[0] ?? 0;
    let face2Index = faces[1] ?? 0;
    const face1 = fold.faces_vertices[face1Index] ?? [];
    const face2 = fold.faces_vertices[face2Index] ?? [];
    if (face1.length !== 3 || face2.length !== 3) return;
    let vertex1 = face1.find((vertex) => vertex !== edge[0] && vertex !== edge[1]);
    let vertex2 = face2.find((vertex) => vertex !== edge[0] && vertex !== edge[1]);
    if (vertex1 === undefined || vertex2 === undefined) return;

    const v1Index = face2.indexOf(edge[0]);
    const v2Index = face2.indexOf(edge[1]);
    if (v2Index - v1Index === 1 || v2Index - v1Index === -2) {
      [face1Index, face2Index] = [face2Index, face1Index];
      [vertex1, vertex2] = [vertex2, vertex1];
    }

    params.push({
      face1: face1Index,
      vertex1,
      face2: face2Index,
      vertex2,
      edge: edgeIndex,
      targetAngle: angle,
    });
  });
  return params;
}
