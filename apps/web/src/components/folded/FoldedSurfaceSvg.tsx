import { useMemo } from 'react';
import type { FoldedBaseSnapshot, FoldedBaseVertex } from '../../engine/types';

const DEFAULT_VIEWBOX = 720;
const DEFAULT_PADDING = 62;
const EMPTY_HIGHLIGHTS: ReadonlySet<number> = new Set<number>();

export interface FoldedSurfaceViewOptions {
  wireframe: boolean;
  translucent: boolean;
}

export interface FoldedSurfaceHighlights {
  creases?: ReadonlySet<number>;
  facets?: ReadonlySet<number>;
}

interface FoldedSurfaceSvgProps {
  snapshot: FoldedBaseSnapshot;
  viewOptions: FoldedSurfaceViewOptions;
  ariaLabel: string;
  className?: string;
  surface?: 'folded-base' | 'sequence-preview';
  viewBoxSize?: number;
  padding?: number;
  guideCreases?: ReadonlyMap<number, number>;
  highlights?: FoldedSurfaceHighlights;
}

export function FoldedSurfaceSvg({
  snapshot,
  viewOptions,
  ariaLabel,
  className = 'folded-base-canvas',
  surface = 'folded-base',
  viewBoxSize = DEFAULT_VIEWBOX,
  padding = DEFAULT_PADDING,
  guideCreases,
  highlights,
}: FoldedSurfaceSvgProps) {
  const projection = useMemo(
    () => createProjection(snapshot.vertices, viewBoxSize, padding),
    [padding, snapshot.vertices, viewBoxSize]
  );
  const verticesById = useMemo(
    () => new Map(snapshot.vertices.map((vertex) => [vertex.id, vertex])),
    [snapshot.vertices]
  );
  const facets = useMemo(
    () => [...snapshot.facets].sort((a, b) => a.order - b.order || a.id - b.id),
    [snapshot.facets]
  );
  const highlightedCreases = highlights?.creases ?? EMPTY_HIGHLIGHTS;
  const highlightedFacets = highlights?.facets ?? EMPTY_HIGHLIGHTS;
  const showCreases = viewOptions.wireframe;
  const renderedCreases = useMemo(
    () =>
      snapshot.creases
        .filter((crease) => {
          if (showCreases || crease.fold === 3) return true;
          if (guideFoldForCrease(crease, guideCreases) !== null) return true;
          return creaseHighlighted(crease, highlightedCreases);
        })
        .sort(
          (a, b) =>
            Number(guideFoldForCrease(a, guideCreases) !== null) -
            Number(guideFoldForCrease(b, guideCreases) !== null) ||
            Number(creaseHighlighted(a, highlightedCreases)) -
            Number(creaseHighlighted(b, highlightedCreases))
        ),
    [guideCreases, highlightedCreases, showCreases, snapshot.creases]
  );

  return (
    <svg
      className={className}
      data-wireframe={viewOptions.wireframe || undefined}
      data-translucent={viewOptions.translucent || undefined}
      data-surface={surface}
      viewBox={`0 0 ${viewBoxSize} ${viewBoxSize}`}
      role="img"
      aria-label={ariaLabel}
    >
      {facets.map((facet) => {
        const points = facet.vertices
          .map((id) => verticesById.get(id))
          .filter(isVertex)
          .map((vertex) => projection(vertex))
          .map((point) => `${point.x},${point.y}`)
          .join(' ');
        if (!points) return null;
        return (
          <polygon
            key={facet.id}
            className={[
              'folded-base-facet',
              `folded-base-facet--color-${facet.color}`,
              facetHighlighted(facet, highlightedFacets) ? 'folded-base-facet--highlight' : '',
            ].join(' ')}
            points={points}
          />
        );
      })}
      {renderedCreases.map((crease) => {
        const a = verticesById.get(crease.vertices[0]);
        const b = verticesById.get(crease.vertices[1]);
        if (!a || !b) return null;
        const p1 = projection(a);
        const p2 = projection(b);
        const guideFold = guideFoldForCrease(crease, guideCreases);
        const guided = guideFold !== null;
        const highlighted = creaseHighlighted(crease, highlightedCreases);
        const fold = guided ? guideFold : crease.fold;
        return (
          <line
            key={crease.id}
            className={
              guided || showCreases || highlighted
                ? [
                    'folded-base-crease',
                    `folded-base-crease--fold-${fold}`,
                    guided ? 'folded-base-crease--guide' : '',
                    highlighted ? 'folded-base-crease--highlight' : '',
                  ].join(' ')
                : 'folded-base-outline'
            }
            x1={p1.x}
            y1={p1.y}
            x2={p2.x}
            y2={p2.y}
          />
        );
      })}
      {viewOptions.wireframe &&
        snapshot.vertices.map((vertex) => {
          const point = projection(vertex);
          return (
            <circle
              key={vertex.id}
              className={
                vertex.is_border
                  ? 'folded-base-vertex folded-base-vertex--border'
                  : 'folded-base-vertex'
              }
              cx={point.x}
              cy={point.y}
              r={vertex.is_border ? 3.2 : 2.4}
            />
          );
        })}
    </svg>
  );
}

function createProjection(vertices: FoldedBaseVertex[], viewBoxSize: number, padding: number) {
  const bounds = vertices.reduce(
    (acc, vertex) => ({
      minX: Math.min(acc.minX, vertex.loc.x),
      maxX: Math.max(acc.maxX, vertex.loc.x),
      minY: Math.min(acc.minY, vertex.loc.y),
      maxY: Math.max(acc.maxY, vertex.loc.y),
    }),
    { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity }
  );
  const minX = Number.isFinite(bounds.minX) ? bounds.minX : 0;
  const maxX = Number.isFinite(bounds.maxX) ? bounds.maxX : 1;
  const minY = Number.isFinite(bounds.minY) ? bounds.minY : 0;
  const maxY = Number.isFinite(bounds.maxY) ? bounds.maxY : 1;
  const spanX = Math.max(0.001, maxX - minX);
  const spanY = Math.max(0.001, maxY - minY);
  const scale = Math.min((viewBoxSize - padding * 2) / spanX, (viewBoxSize - padding * 2) / spanY);
  const offsetX = (viewBoxSize - spanX * scale) / 2;
  const offsetY = (viewBoxSize - spanY * scale) / 2;

  return (vertex: FoldedBaseVertex) => ({
    x: offsetX + (vertex.loc.x - minX) * scale,
    y: viewBoxSize - offsetY - (vertex.loc.y - minY) * scale,
  });
}

function creaseHighlighted(
  crease: FoldedBaseSnapshot['creases'][number],
  highlightedCreases: ReadonlySet<number>
): boolean {
  return creaseSelected(crease, highlightedCreases);
}

function creaseSelected(
  crease: FoldedBaseSnapshot['creases'][number],
  selectedCreases: ReadonlySet<number>
): boolean {
  return selectedCreases.has(crease.source_crease) || selectedCreases.has(crease.id);
}

function guideFoldForCrease(
  crease: FoldedBaseSnapshot['creases'][number],
  guideCreases: ReadonlyMap<number, number> | undefined
): number | null {
  return guideCreases?.get(crease.source_crease) ?? guideCreases?.get(crease.id) ?? null;
}

function facetHighlighted(
  facet: FoldedBaseSnapshot['facets'][number],
  highlightedFacets: ReadonlySet<number>
): boolean {
  return highlightedFacets.has(facet.source_facet) || highlightedFacets.has(facet.id);
}

function isVertex(vertex: FoldedBaseVertex | undefined): vertex is FoldedBaseVertex {
  return vertex !== undefined;
}
