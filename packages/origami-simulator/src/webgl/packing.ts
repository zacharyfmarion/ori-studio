// Packs an OrigamiModel into the flat RGBA-float textures the GPU solver reads.
//
// The layout mirrors upstream's dynamicSolver.js exactly, because the shaders
// (which are ported verbatim) index into it by hand. Node/edge/crease/face data
// is laid out CSR-style: a per-node `meta` texture holds an (offset, count) into
// flat neighbour textures, so there is no maximum valence -- which matters for
// the high-degree vertices real crease patterns produce.
//
// Cross-reference of every texture, and the upstream builder it comes from:
//   position/originalPosition  updateOriginalPosition
//   mass                       updateFixed (all mass 1, nothing fixed)
//   meta        [beamStart, numBeams, nodeCreaseStart, numNodeCreases]
//   beamMeta    [k, d, restLength, otherNodeIndex]      updateMaterials
//   meta2       [nodeFaceStart, numFaces]
//   nodeFaceMeta[faceIndex, a, b, c]   (a/b/c = -1 for this node's own corner)
//   nodeCreaseMeta [creaseIndex, nodeType(1..4)]
//   creaseMeta  [k, d, targetTheta]                     updateCreasesMeta
//   creaseMeta2 [node1, node2, edgeNode0, edgeNode1]    (updateCreaseGeo input)
//   creaseVectors [edgeNode0, edgeNode1]                (thetaCalc input)
//   theta init  [0, 0, face1Index, face2Index]  (-1,-1,-1,-1 to disable)
//   faceVertexIndices [v0, v1, v2]
//   nominalTriangles  [angleA, angleB, angleC]
import type { OrigamiModel } from '../model.js';
import { textureSizeFor } from './glCore.js';

const DEG_TO_RAD = Math.PI / 180;
const EPSILON = 1e-6;

export interface SolverMaterial {
  axialStiffness: number;
  creaseStiffness: number;
  panelStiffness: number;
  faceStiffness: number;
  damping: number;
  timeStepScale: number;
}

export interface PackedDimensions {
  nodes: number;
  edges: number; // node-beam incidences (2 per edge)
  faces: number;
  creases: number;
  nodeCreases: number; // node-crease incidences (4 per crease)
  nodeFaces: number; // node-face incidences (3 per triangle)
  textureDim: number;
  textureDimEdges: number;
  textureDimFaces: number;
  textureDimCreases: number;
  textureDimNodeCreases: number;
  textureDimNodeFaces: number;
}

export interface PackedModel {
  dims: PackedDimensions;
  /** Static topology, uploaded once. */
  meta: Float32Array;
  meta2: Float32Array;
  nodeFaceMeta: Float32Array;
  nodeCreaseMeta: Float32Array;
  creaseMeta2: Float32Array;
  creaseVectors: Float32Array;
  faceVertexIndices: Float32Array;
  nominalTriangles: Float32Array;
  mass: Float32Array;
  originalPosition: Float32Array;
  externalForces: Float32Array;
  thetaInit: Float32Array;
  /** Beam rest lengths and neighbour indices, needed to rebuild beamMeta on material change. */
  beamRestLength: Float32Array;
  beamOtherNode: Float32Array;
  /** Which creases are flat panels (targetAngle 0) vs folds; and their rest lengths and target radians. */
  creaseIsFlat: Uint8Array;
  creaseRestLength: Float32Array;
  creaseTargetRadians: Float32Array;
  /** Largest beam natural frequency, for the timestep. */
  maxNaturalFrequency: number;
}

/**
 * Fold profiles (a per-crease from/to angle range) are our addition, not
 * upstream's, and they scale nonlinearly in a way the single `creasePercent`
 * uniform cannot express. The GPU backend supports the standard uniform-target
 * path; callers with a non-trivial fold profile fall back to ReferenceSolver.
 */
export function supportsGpuFoldModel(model: OrigamiModel): boolean {
  // Every crease reduces to targetTheta * creasePercent, which is exactly what
  // the standard path (no profile) is. Profiles are handled by the caller's
  // backend selection, so nothing model-specific blocks the GPU path here.
  return model.prepared.creaseParams.length > 0 && model.prepared.faceCount > 0;
}

export function packModel(model: OrigamiModel, material: SolverMaterial): PackedModel {
  const prepared = model.prepared;
  const nodeCount = prepared.vertexCount;
  const faceCount = prepared.faceCount;
  const creaseParams = prepared.creaseParams;
  const creaseCount = creaseParams.length;

  // --- per-node beam incidences (CSR) ---
  const nodeBeams: Array<{ other: number; rest: number }[]> = Array.from(
    { length: nodeCount },
    () => [],
  );
  prepared.edgesVertices.forEach((edge, edgeIndex) => {
    const rest = Math.max(EPSILON, model.edgeRestLength(edgeIndex));
    nodeBeams[edge[0]]!.push({ other: edge[1], rest });
    nodeBeams[edge[1]]!.push({ other: edge[0], rest });
  });
  const edgeIncidences = nodeBeams.reduce((sum, list) => sum + list.length, 0);

  // --- per-node crease incidences (types 1..4) ---
  const nodeCreases: Array<{ crease: number; type: number }[]> = Array.from(
    { length: nodeCount },
    () => [],
  );
  creaseParams.forEach((crease, creaseIndex) => {
    const edge = prepared.edgesVertices[crease.edge];
    if (!edge) return;
    nodeCreases[crease.vertex1]!.push({ crease: creaseIndex, type: 1 });
    nodeCreases[crease.vertex2]!.push({ crease: creaseIndex, type: 2 });
    nodeCreases[edge[0]]!.push({ crease: creaseIndex, type: 3 });
    nodeCreases[edge[1]]!.push({ crease: creaseIndex, type: 4 });
  });
  const nodeCreaseIncidences = nodeCreases.reduce((sum, list) => sum + list.length, 0);

  // --- per-node face incidences ---
  const nodeFaces: Array<number[]> = Array.from({ length: nodeCount }, () => []);
  prepared.facesVertices.forEach((face, faceIndex) => {
    if (face.length !== 3) return;
    for (const vertex of face) nodeFaces[vertex]!.push(faceIndex);
  });
  const nodeFaceIncidences = nodeFaces.reduce((sum, list) => sum + list.length, 0);

  const dims: PackedDimensions = {
    nodes: nodeCount,
    edges: edgeIncidences,
    faces: faceCount,
    creases: creaseCount,
    nodeCreases: nodeCreaseIncidences,
    nodeFaces: nodeFaceIncidences,
    textureDim: textureSizeFor(nodeCount),
    textureDimEdges: textureSizeFor(edgeIncidences),
    textureDimFaces: textureSizeFor(faceCount),
    textureDimCreases: textureSizeFor(creaseCount),
    textureDimNodeCreases: textureSizeFor(nodeCreaseIncidences),
    textureDimNodeFaces: textureSizeFor(nodeFaceIncidences),
  };

  const rgba = (size: number) => new Float32Array(size * size * 4);

  const meta = rgba(dims.textureDim);
  const meta2 = rgba(dims.textureDim);
  const mass = rgba(dims.textureDim);
  const originalPosition = rgba(dims.textureDim);
  const externalForces = rgba(dims.textureDim);
  const beamRestLength = new Float32Array(edgeIncidences);
  const beamOtherNode = new Float32Array(edgeIncidences);
  const nodeCreaseMeta = rgba(dims.textureDimNodeCreases);
  const nodeFaceMeta = rgba(dims.textureDimNodeFaces);

  // Node positions are radius-normalised into model.originalPositions already.
  for (let i = 0; i < nodeCount; i += 1) {
    originalPosition[i * 4] = model.originalPositions[i * 3] ?? 0;
    originalPosition[i * 4 + 1] = model.originalPositions[i * 3 + 1] ?? 0;
    originalPosition[i * 4 + 2] = model.originalPositions[i * 3 + 2] ?? 0;
    mass[i * 4] = 1; // getSimMass() is 1 upstream
    mass[i * 4 + 1] = 0; // nothing fixed
  }

  // beam CSR
  let beamCursor = 0;
  for (let i = 0; i < nodeCount; i += 1) {
    meta[i * 4] = beamCursor;
    meta[i * 4 + 1] = nodeBeams[i]!.length;
    for (const beam of nodeBeams[i]!) {
      beamRestLength[beamCursor] = beam.rest;
      beamOtherNode[beamCursor] = beam.other;
      beamCursor += 1;
    }
  }

  // node-crease CSR
  let nodeCreaseCursor = 0;
  for (let i = 0; i < nodeCount; i += 1) {
    meta[i * 4 + 2] = nodeCreaseCursor;
    meta[i * 4 + 3] = nodeCreases[i]!.length;
    for (const incidence of nodeCreases[i]!) {
      nodeCreaseMeta[nodeCreaseCursor * 4] = incidence.crease;
      nodeCreaseMeta[nodeCreaseCursor * 4 + 1] = incidence.type;
      nodeCreaseCursor += 1;
    }
  }

  // node-face CSR
  let nodeFaceCursor = 0;
  for (let i = 0; i < nodeCount; i += 1) {
    meta2[i * 4] = nodeFaceCursor;
    meta2[i * 4 + 1] = nodeFaces[i]!.length;
    for (const faceIndex of nodeFaces[i]!) {
      const face = prepared.facesVertices[faceIndex]!;
      nodeFaceMeta[nodeFaceCursor * 4] = faceIndex;
      nodeFaceMeta[nodeFaceCursor * 4 + 1] = face[0] === i ? -1 : face[0]!;
      nodeFaceMeta[nodeFaceCursor * 4 + 2] = face[1] === i ? -1 : face[1]!;
      nodeFaceMeta[nodeFaceCursor * 4 + 3] = face[2] === i ? -1 : face[2]!;
      nodeFaceCursor += 1;
    }
  }

  // per-face vertex indices and nominal triangle angles
  const faceVertexIndices = rgba(dims.textureDimFaces);
  const nominalTriangles = rgba(dims.textureDimFaces);
  for (let f = 0; f < faceCount; f += 1) {
    const face = prepared.facesVertices[f]!;
    faceVertexIndices[f * 4] = face[0]!;
    faceVertexIndices[f * 4 + 1] = face[1]!;
    faceVertexIndices[f * 4 + 2] = face[2]!;
    const angles = nominalTriangleAngles(model.originalPositions, face[0]!, face[1]!, face[2]!);
    nominalTriangles[f * 4] = angles[0];
    nominalTriangles[f * 4 + 1] = angles[1];
    nominalTriangles[f * 4 + 2] = angles[2];
  }

  // per-crease textures
  const creaseMeta2 = rgba(dims.textureDimCreases);
  const creaseVectors = rgba(dims.textureDimCreases);
  const thetaInit = rgba(dims.textureDimCreases);
  const creaseIsFlat = new Uint8Array(creaseCount);
  const creaseRestLength = new Float32Array(creaseCount);
  const creaseTargetRadians = new Float32Array(creaseCount);
  for (let c = 0; c < creaseCount; c += 1) {
    const crease = creaseParams[c]!;
    const edge = prepared.edgesVertices[crease.edge]!;
    creaseMeta2[c * 4] = crease.vertex1;
    creaseMeta2[c * 4 + 1] = crease.vertex2;
    creaseMeta2[c * 4 + 2] = edge[0];
    creaseMeta2[c * 4 + 3] = edge[1];
    creaseVectors[c * 4] = edge[0];
    creaseVectors[c * 4 + 1] = edge[1];
    // theta accumulator seeds at 0 with the two adjacent face (normal) indices.
    thetaInit[c * 4] = 0;
    thetaInit[c * 4 + 1] = 0;
    thetaInit[c * 4 + 2] = crease.face1;
    thetaInit[c * 4 + 3] = crease.face2;
    creaseIsFlat[c] = crease.targetAngle === 0 ? 1 : 0;
    creaseRestLength[c] = Math.max(EPSILON, model.edgeRestLength(crease.edge));
    creaseTargetRadians[c] = crease.targetAngle * DEG_TO_RAD;
  }

  const maxNaturalFrequency = computeMaxNaturalFrequency(beamRestLength, material.axialStiffness);

  return {
    dims,
    meta,
    meta2,
    nodeFaceMeta,
    nodeCreaseMeta,
    creaseMeta2,
    creaseVectors,
    faceVertexIndices,
    nominalTriangles,
    mass,
    originalPosition,
    externalForces,
    thetaInit,
    beamRestLength,
    beamOtherNode,
    creaseIsFlat,
    creaseRestLength,
    creaseTargetRadians,
    maxNaturalFrequency,
  };
}

/** beamMeta = [k, d, restLength, otherNodeIndex] per incidence; k/d depend on material. */
export function packBeamMeta(packed: PackedModel, material: SolverMaterial): Float32Array {
  const size = packed.dims.textureDimEdges;
  const out = new Float32Array(size * size * 4);
  const axial = Math.max(0, material.axialStiffness);
  const damping = Math.max(0, material.damping);
  for (let i = 0; i < packed.dims.edges; i += 1) {
    const rest = packed.beamRestLength[i]!;
    const k = axial / rest;
    out[i * 4] = k;
    out[i * 4 + 1] = damping * 2 * Math.sqrt(k); // getD with minMass 1
    out[i * 4 + 2] = rest;
    out[i * 4 + 3] = packed.beamOtherNode[i]!;
  }
  return out;
}

/** creaseMeta = [k, unused d, targetTheta] per crease; k depends on material. */
export function packCreaseMeta(packed: PackedModel, material: SolverMaterial): Float32Array {
  const size = packed.dims.textureDimCreases;
  const out = new Float32Array(size * size * 4);
  for (let c = 0; c < packed.dims.creases; c += 1) {
    const stiffness = packed.creaseIsFlat[c] ? material.panelStiffness : material.creaseStiffness;
    out[c * 4] = stiffness * packed.creaseRestLength[c]!;
    out[c * 4 + 2] = packed.creaseTargetRadians[c]!;
  }
  return out;
}

/** Timestep: 0.9 / (2 pi maxFreq), scaled. Matches ReferenceSolver.timeStep and upstream calcDt. */
export function timeStepFor(packed: PackedModel, material: SolverMaterial): number {
  const freq = computeMaxNaturalFrequency(packed.beamRestLength, material.axialStiffness);
  if (freq <= EPSILON) return 1 / 60;
  const scale = Number.isFinite(material.timeStepScale)
    ? Math.min(1, Math.max(0.05, material.timeStepScale))
    : 1;
  return (0.9 / (2 * Math.PI * freq)) * scale;
}

function computeMaxNaturalFrequency(beamRestLength: Float32Array, axialStiffness: number): number {
  const axial = Math.max(0, axialStiffness);
  let max = 0;
  for (let i = 0; i < beamRestLength.length; i += 1) {
    const freq = Math.sqrt(axial / beamRestLength[i]!);
    if (freq > max) max = freq;
  }
  return max;
}

function nominalTriangleAngles(
  positions: Float32Array,
  a: number,
  b: number,
  c: number,
): [number, number, number] {
  const ax = positions[a * 3]!,
    ay = positions[a * 3 + 1]!,
    az = positions[a * 3 + 2]!;
  const bx = positions[b * 3]!,
    by = positions[b * 3 + 1]!,
    bz = positions[b * 3 + 2]!;
  const cx = positions[c * 3]!,
    cy = positions[c * 3 + 1]!,
    cz = positions[c * 3 + 2]!;
  const ab = normalize(bx - ax, by - ay, bz - az);
  const ac = normalize(cx - ax, cy - ay, cz - az);
  const bc = normalize(cx - bx, cy - by, cz - bz);
  return [
    Math.acos(clampUnit(ab[0] * ac[0] + ab[1] * ac[1] + ab[2] * ac[2])),
    Math.acos(clampUnit(-(ab[0] * bc[0] + ab[1] * bc[1] + ab[2] * bc[2]))),
    Math.acos(clampUnit(ac[0] * bc[0] + ac[1] * bc[1] + ac[2] * bc[2])),
  ];
}

function normalize(x: number, y: number, z: number): [number, number, number] {
  const length = Math.hypot(x, y, z);
  if (length <= EPSILON) return [0, 1, 0];
  return [x / length, y / length, z / length];
}

function clampUnit(value: number): number {
  return value < -1 ? -1 : value > 1 ? 1 : value;
}
