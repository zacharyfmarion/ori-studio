import type { TreeSnapshot } from './types';
import type { CreaseLine, FacetShape, TreeProject } from '../lib/sampleProject';

function isTreeOwner(owner: unknown): boolean {
  return owner === 'Tree';
}

function foldName(fold: number): CreaseLine['fold'] {
  switch (fold) {
    case 1:
      return 'mountain';
    case 2:
      return 'valley';
    case 3:
      return 'border';
    default:
      return 'flat';
  }
}

function kindName(kind: number): CreaseLine['kind'] {
  switch (kind) {
    case 0:
      return 'axial';
    case 1:
      return 'gusset';
    case 2:
      return 'ridge';
    case 3:
    case 4:
      return 'hinge';
    default:
      return 'pseudohinge';
  }
}

function facetColor(color: number): FacetShape['color'] {
  switch (color) {
    case 1:
      return 'white';
    case 2:
      return 'color';
    default:
      return 'unset';
  }
}

function isDesignVisiblePath(path: TreeSnapshot['paths'][number]): boolean {
  if (path.nodes.length < 2) return false;

  return path.is_leaf || path.is_active || path.is_border || path.is_polygon || path.is_conditioned;
}

export function projectFromSnapshot(snapshot: TreeSnapshot, titleOverride?: string): TreeProject {
  const vertexLocs = new Map(snapshot.vertices.map((vertex) => [vertex.id, vertex.loc]));
  const title =
    titleOverride ?? (snapshot.summary.creases > 0 ? 'Generated crease pattern' : 'Untitled');

  return {
    title,
    paper: {
      width: snapshot.paper.width,
      height: snapshot.paper.height,
      symLoc: snapshot.paper.sym_loc,
      symAngle: snapshot.paper.sym_angle,
    },
    scale: snapshot.paper.scale,
    hasSymmetry: snapshot.paper.has_symmetry,
    nodes: snapshot.nodes
      .filter((node) => isTreeOwner(node.owner))
      .map((node) => ({
        id: node.id,
        label: node.label || `n${node.id}`,
        loc: node.loc,
        isLeaf: node.is_leaf,
        isPinned: node.is_pinned,
        isConditioned: node.is_conditioned,
      })),
    edges: snapshot.edges.map((edge) => ({
      id: edge.id,
      label: edge.label || `e${edge.id}`,
      nodes: [edge.nodes[0], edge.nodes[1]] as [number, number],
      length: edge.length,
      strain: edge.strain,
      stiffness: edge.stiffness,
      isConditioned: edge.is_conditioned,
    })),
    paths: snapshot.paths.filter(isDesignVisiblePath).map((path) => ({
      id: path.id,
      nodes: [path.nodes[0], path.nodes[path.nodes.length - 1]] as [number, number],
      isLeaf: path.is_leaf,
      isActive: path.is_active,
      isFeasible: path.is_feasible,
      isBorder: path.is_border,
      isPolygon: path.is_polygon,
      isConditioned: path.is_conditioned,
    })),
    creases: snapshot.creases.flatMap((crease) => {
      const a = vertexLocs.get(crease.vertices[0]);
      const b = vertexLocs.get(crease.vertices[1]);
      if (!a || !b) return [];
      return [
        {
          id: crease.id,
          vertices: [a, b] as [typeof a, typeof b],
          fold: foldName(crease.fold),
          kind: kindName(crease.kind),
        },
      ];
    }),
    facets: snapshot.facets.flatMap((facet) => {
      const vertices = facet.vertices.flatMap((id) => {
        const loc = vertexLocs.get(id);
        return loc ? [loc] : [];
      });
      if (vertices.length < 3) return [];
      return [
        {
          id: facet.id,
          vertices,
          color: facetColor(facet.color),
          corridorEdge: facet.corridor_edge ?? undefined,
        },
      ];
    }),
    conditions: snapshot.conditions.map((condition) => ({
      id: condition.index,
      isFeasible: condition.is_feasible,
      kind: condition.kind,
    })),
  };
}
