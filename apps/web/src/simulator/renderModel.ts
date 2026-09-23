import {
  edgeBoundaryFlags,
  type FaceAdjacency,
  type FoldAssignment,
} from '@treemaker/origami-simulator';
import {
  EDGE_ASSIGNMENT_CODES,
  type SimulatorModelInfo,
} from './simulatorSession';

/**
 * The topology the render side needs, in the shape the draw code wants.
 *
 * This is deliberately a subset of `PreparedOrigamiModel`: the worker owns the
 * real prepared model, and the renderer only ever touched these six things.
 * Keeping the shape identical means the existing draw path did not have to
 * change when the solver moved off-thread.
 */
export interface SimulatorRenderModel {
  vertexCount: number;
  faceCount: number;
  indices: Uint32Array;
  edgesVertices: [number, number][];
  edgesAssignment: FoldAssignment[];
  /** One `EDGE_CODE` per edge; see `SimulatorModelInfo.edgeCodes`. */
  edgeCodes: Uint8Array;
  /**
   * Which ends of each edge retreat under erode — `edgeBoundaryFlags`, the
   * rule the GPU pass and the vector scene read. Per topology, so once here.
   */
  edgeBoundary: Uint8Array;
  facesEdges: number[][];
  /**
   * Which paper each crease lies on (`faceAdjacency`), for creases drawn only
   * where their paper shows (`RenderSettings.creaseVisibility`). Absent, depth
   * decides which creases show.
   */
  paper?: FaceAdjacency;
  /** The unfolded sheet's extent in world units, the unit erode is a fraction of. */
  sheet: number;
}

/**
 * Inflate the worker's flat transfer buffers once per model load. This produces
 * the arrays-of-arrays the 2-D draw path indexes into; it is O(edges) and runs
 * on load, not per frame.
 *
 * Phase 2 replaces the canvas-2D renderer with WebGL, which consumes the flat
 * buffers directly and will make this inflation unnecessary.
 */
export function inflateRenderModel(info: SimulatorModelInfo): SimulatorRenderModel {
  const edgePairs = new Int32Array(info.edgesVertices);
  const assignmentCodes = new Uint8Array(info.edgesAssignment);
  const edgeCodes = new Uint8Array(info.edgeCodes);
  const faceEdgeTriples = new Int32Array(info.facesEdges);

  const edgesVertices: [number, number][] = [];
  const edgesAssignment: FoldAssignment[] = [];
  for (let i = 0; i < assignmentCodes.length; i += 1) {
    edgesVertices.push([edgePairs[i * 2]!, edgePairs[i * 2 + 1]!]);
    edgesAssignment.push(
      (EDGE_ASSIGNMENT_CODES[assignmentCodes[i]!] ?? 'U') as FoldAssignment
    );
  }

  const facesEdges: number[][] = [];
  for (let face = 0; face < info.faceCount; face += 1) {
    facesEdges.push([
      faceEdgeTriples[face * 3]!,
      faceEdgeTriples[face * 3 + 1]!,
      faceEdgeTriples[face * 3 + 2]!,
    ]);
  }

  return {
    vertexCount: info.vertexCount,
    faceCount: info.faceCount,
    indices: new Uint32Array(info.indices),
    edgesVertices,
    edgesAssignment,
    edgeCodes,
    edgeBoundary: edgeBoundaryFlags(
      { edgeIndices: edgePairs, edgeAssignments: edgeCodes, auxEnds: new Uint8Array(info.auxEnds) },
      info.vertexCount
    ),
    facesEdges,
    paper: {
      faceGroups: new Int32Array(info.faceGroups),
      edgeFaces: new Int32Array(info.edgeFaces),
      edgeApex: new Int32Array(info.edgeApex),
    },
    sheet: info.sheet,
  };
}
