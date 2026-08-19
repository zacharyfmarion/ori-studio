import type { TreeProject } from './sampleProject';
import { symmetrySide, type SymmetryAxis } from './symmetryGeometry';

// The pure geometry now lives in ./symmetryGeometry (shared with the BP-tree
// adapter). Re-export it here so this module stays the one-stop import for
// TreeMaker's symmetry authoring (DesignPanel, editingSlice).
export {
  SYMMETRY_AUTHORING_TOLERANCE,
  axisDirection,
  distanceToSymmetryAxis,
  projectOntoSymmetryAxis,
  reflectPointAcrossSymmetryAxis,
  snapPointToSymmetryAxis,
  symmetrySide,
  type SymmetryAxis,
} from './symmetryGeometry';

export interface SymmetryAuthoringPair {
  node1: number;
  node2: number;
}

function nodeExists(project: TreeProject, nodeId: number): boolean {
  return project.nodes.some((node) => node.id === nodeId);
}

export function symmetryAxisForProject(project: TreeProject): SymmetryAxis {
  return {
    loc: project.paper.symLoc,
    angle: project.paper.symAngle,
  };
}

export function findPairedNodeId(project: TreeProject, nodeId: number): number | null {
  for (const condition of project.conditions) {
    if (condition.kind.type !== 'nodes_paired') continue;
    if (condition.kind.node1 === nodeId) return condition.kind.node2;
    if (condition.kind.node2 === nodeId) return condition.kind.node1;
  }
  return null;
}

export function addSymmetryAuthoringPair(
  pairs: SymmetryAuthoringPair[],
  node1: number,
  node2: number,
): SymmetryAuthoringPair[] {
  if (node1 === node2) return pairs;
  const nextPair = {
    node1: Math.min(node1, node2),
    node2: Math.max(node1, node2),
  };
  if (pairs.some((pair) => pair.node1 === nextPair.node1 && pair.node2 === nextPair.node2)) {
    return pairs;
  }
  return [...pairs, nextPair];
}

export function filterSymmetryAuthoringPairs(
  project: TreeProject,
  pairs: SymmetryAuthoringPair[],
): SymmetryAuthoringPair[] {
  return pairs.filter(
    (pair) =>
      pair.node1 !== pair.node2 &&
      nodeExists(project, pair.node1) &&
      nodeExists(project, pair.node2),
  );
}

export function findSymmetryAuthoringPairId(
  project: TreeProject,
  pairs: SymmetryAuthoringPair[],
  nodeId: number,
): number | null {
  const pair = pairs.find(
    (candidate) =>
      (candidate.node1 === nodeId || candidate.node2 === nodeId) &&
      nodeExists(project, candidate.node1) &&
      nodeExists(project, candidate.node2),
  );
  if (!pair) return null;
  return pair.node1 === nodeId ? pair.node2 : pair.node1;
}

export function findMirrorNodeId(
  project: TreeProject,
  pairs: SymmetryAuthoringPair[],
  nodeId: number,
): number | null {
  return findPairedNodeId(project, nodeId) ?? findSymmetryAuthoringPairId(project, pairs, nodeId);
}

function mirroredNodeForEdgeEndpoint(
  project: TreeProject,
  pairs: SymmetryAuthoringPair[],
  nodeId: number,
): number | null {
  const paired = findMirrorNodeId(project, pairs, nodeId);
  if (paired) return paired;
  const node = project.nodes.find((candidate) => candidate.id === nodeId);
  if (!node || !project.hasSymmetry) return null;
  return symmetrySide(node.loc, symmetryAxisForProject(project)) === 0 ? node.id : null;
}

export function findMirrorEdgeId(
  project: TreeProject,
  pairs: SymmetryAuthoringPair[],
  edgeId: number,
): number | null {
  const edge = project.edges.find((candidate) => candidate.id === edgeId);
  if (!edge || !project.hasSymmetry) return null;
  const node1 = mirroredNodeForEdgeEndpoint(project, pairs, edge.nodes[0]);
  const node2 = mirroredNodeForEdgeEndpoint(project, pairs, edge.nodes[1]);
  if (!node1 || !node2 || (node1 === edge.nodes[0] && node2 === edge.nodes[1])) return null;
  const mirrored = project.edges.find(
    (candidate) =>
      candidate.id !== edge.id &&
      ((candidate.nodes[0] === node1 && candidate.nodes[1] === node2) ||
        (candidate.nodes[0] === node2 && candidate.nodes[1] === node1)),
  );
  return mirrored?.id ?? null;
}
