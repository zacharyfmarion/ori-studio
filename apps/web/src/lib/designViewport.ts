import { leafCirclePaperRadius } from './packingCircles';
import type { TreeNode, TreeProject } from './sampleProject';
import {
  clampPaperPoint,
  formatNumber,
  paperToSvg,
  svgToPaper,
  type PlotRect,
  type Point,
} from './geometry';

export const DESIGN_VIEWBOX_SIZE = 720;
export const DESIGN_PAPER_RECT: PlotRect = { x: 66, y: 54, width: 588, height: 588 };
export const DESIGN_BASE_WORLD_RECT: PlotRect = {
  x: 0,
  y: 0,
  width: DESIGN_VIEWBOX_SIZE,
  height: DESIGN_VIEWBOX_SIZE,
};
export const DESIGN_PAPER_SHADOW_RECT: PlotRect = { x: 56, y: 44, width: 608, height: 608 };

const WORLD_PADDING = 32;
export const VIEWPORT_FIT_PADDING = 96;
const NODE_RADIUS = 14;
const LEAF_NODE_RADIUS = 14;
const LABEL_HEIGHT = 22;
/** View-only floor so a tiny flap's circle is still something you can see. */
const MIN_LEAF_CIRCLE_PX = 22;

export interface DesignViewLayers {
  paths: boolean;
  leafCircles: boolean;
  labels: boolean;
  symmetry: boolean;
}

export type DesignViewLayerKey = keyof DesignViewLayers;

export const DEFAULT_DESIGN_VIEW_LAYERS: DesignViewLayers = {
  paths: true,
  leafCircles: true,
  labels: true,
  symmetry: true,
};

export function setDesignLayerVisibility(
  layers: DesignViewLayers,
  layer: DesignViewLayerKey,
  visible: boolean
): DesignViewLayers {
  return { ...layers, [layer]: visible };
}

interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface DesignWorldOptions {
  nodeLocations?: ReadonlyMap<number, Point>;
  padding?: number;
}

export interface ViewportSize {
  width: number;
  height: number;
}

export interface DesignViewportTransform {
  positionX: number;
  positionY: number;
  scale: number;
}

function includePoint(bounds: Bounds, point: Point): void {
  bounds.minX = Math.min(bounds.minX, point.x);
  bounds.minY = Math.min(bounds.minY, point.y);
  bounds.maxX = Math.max(bounds.maxX, point.x);
  bounds.maxY = Math.max(bounds.maxY, point.y);
}

function includeRect(bounds: Bounds, rect: PlotRect): void {
  includePoint(bounds, { x: rect.x, y: rect.y });
  includePoint(bounds, { x: rect.x + rect.width, y: rect.y + rect.height });
}

function includeCircle(bounds: Bounds, center: Point, radius: number): void {
  includeRect(bounds, {
    x: center.x - radius,
    y: center.y - radius,
    width: radius * 2,
    height: radius * 2,
  });
}

function labelWidth(text: string, characterWidth: number): number {
  return Math.max(18, text.length * characterWidth) + 12;
}

function nodeLoc(node: TreeNode, options?: DesignWorldOptions): Point {
  return options?.nodeLocations?.get(node.id) ?? node.loc;
}

export function designNodePoint(node: TreeNode, options?: DesignWorldOptions): Point {
  return paperToSvg(nodeLoc(node, options), DESIGN_PAPER_RECT);
}

/**
 * A leaf circle in SVG pixels.
 *
 * The radius itself comes from {@link leafCirclePaperRadius}, shared with what
 * "Send to Edit (include circles)" hands to the Edit canvas — this used to have
 * its own arithmetic that ignored strain, so a strained design drew one circle
 * and would have sent a different one.
 *
 * What stays here is the part that is genuinely about the view: a floor so a
 * tiny flap's circle is still visible, and a fallback for a leaf whose edge is
 * missing.
 */
export function leafCircleRadius(project: TreeProject, nodeId: number): number {
  const paperRadius = leafCirclePaperRadius(nodeId, project.edges, project.scale);
  const fallback = project.scale * DESIGN_PAPER_RECT.width;
  return Math.max(
    MIN_LEAF_CIRCLE_PX,
    paperRadius > 0 ? paperRadius * DESIGN_PAPER_RECT.width : fallback
  );
}

export function getDesignWorldRect(
  project: TreeProject,
  layers: DesignViewLayers = DEFAULT_DESIGN_VIEW_LAYERS,
  options: DesignWorldOptions = {}
): PlotRect {
  const bounds: Bounds = {
    minX: DESIGN_BASE_WORLD_RECT.x,
    minY: DESIGN_BASE_WORLD_RECT.y,
    maxX: DESIGN_BASE_WORLD_RECT.x + DESIGN_BASE_WORLD_RECT.width,
    maxY: DESIGN_BASE_WORLD_RECT.y + DESIGN_BASE_WORLD_RECT.height,
  };

  includeRect(bounds, DESIGN_PAPER_SHADOW_RECT);
  includeRect(bounds, DESIGN_PAPER_RECT);

  for (const node of project.nodes) {
    const point = designNodePoint(node, options);
    includeCircle(bounds, point, node.isLeaf ? LEAF_NODE_RADIUS : NODE_RADIUS);

    if (node.isLeaf && layers.leafCircles) {
      includeCircle(bounds, point, leafCircleRadius(project, node.id));
    }

    if (layers.labels) {
      includeRect(bounds, {
        x: point.x + 8,
        y: point.y - LABEL_HEIGHT / 2,
        width: labelWidth(node.label, 8.2),
        height: LABEL_HEIGHT,
      });
    }
  }

  if (layers.labels) {
    for (const edge of project.edges) {
      const a = project.nodes.find((node) => node.id === edge.nodes[0]);
      const b = project.nodes.find((node) => node.id === edge.nodes[1]);
      if (!a || !b) continue;
      const p1 = designNodePoint(a, options);
      const p2 = designNodePoint(b, options);
      const text = formatNumber(edge.length, 2);
      includeRect(bounds, {
        x: (p1.x + p2.x) / 2 + 6,
        y: (p1.y + p2.y) / 2 - 22,
        width: labelWidth(text, 7.2),
        height: LABEL_HEIGHT,
      });
    }
  }

  const padding = options.padding ?? WORLD_PADDING;
  return {
    x: bounds.minX - padding,
    y: bounds.minY - padding,
    width: bounds.maxX - bounds.minX + padding * 2,
    height: bounds.maxY - bounds.minY + padding * 2,
  };
}

export function getViewportFitScale(
  viewport: ViewportSize,
  targetRect: Pick<PlotRect, 'width' | 'height'>,
  padding = VIEWPORT_FIT_PADDING,
  maxScale = 1
): number {
  const width = Math.max(1, viewport.width - padding);
  const height = Math.max(1, viewport.height - padding);
  return Math.max(0.05, Math.min(width / targetRect.width, height / targetRect.height, maxScale));
}

export function getCenteredDesignTransform(
  viewport: ViewportSize,
  worldRect: PlotRect,
  targetRect: PlotRect,
  padding = VIEWPORT_FIT_PADDING,
  maxScale = 1
): DesignViewportTransform {
  const scale = getViewportFitScale(viewport, targetRect, padding, maxScale);
  const targetCenterX = targetRect.x - worldRect.x + targetRect.width / 2;
  const targetCenterY = targetRect.y - worldRect.y + targetRect.height / 2;

  return {
    scale,
    positionX: viewport.width / 2 - targetCenterX * scale,
    positionY: viewport.height / 2 - targetCenterY * scale,
  };
}

export function clientPointToDesignWorld(
  client: Point,
  bounds: Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>,
  worldRect: PlotRect
): Point {
  if (bounds.width <= 0 || bounds.height <= 0) {
    return { x: worldRect.x, y: worldRect.y };
  }

  return {
    x: worldRect.x + ((client.x - bounds.left) / bounds.width) * worldRect.width,
    y: worldRect.y + ((client.y - bounds.top) / bounds.height) * worldRect.height,
  };
}

export function clientPointToPaper(
  client: Point,
  bounds: Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>,
  worldRect: PlotRect,
  paperRect: PlotRect = DESIGN_PAPER_RECT
): Point {
  return clampPaperPoint(svgToPaper(clientPointToDesignWorld(client, bounds, worldRect), paperRect));
}
