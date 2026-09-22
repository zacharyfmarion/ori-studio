import {
  EDGE_BOUNDARY_A,
  EDGE_BOUNDARY_B,
  EDGE_CODE,
  erodePx,
  fitExtent,
  shadeColor,
  shadeFor,
  viewRotationFor,
} from "@treemaker/origami-simulator";
import type {
  CreaseDash,
  FoldDocument as SimulatorFoldDocument,
  Vec3Like,
} from "@treemaker/origami-simulator";
import { erodeSegment } from "../lib/paper/paperSvg";
import type { SimulatorFrameView } from "./useSimulatorRuntime";
import type { SimulatorRenderModel } from "./renderModel";
import type { SimulatorOrbitView as SimulatorView } from "../lib/simulatorOrbit";
import {
  renderColorToRgb,
  renderColorToCss,
  type Rgb,
  type SimulatorPaint,
  type SimulatorSurfaceOptions,
} from "./simulatorPalette";

export { type SimulatorSurfaceOptions };

/**
 * The canvas-2D software rasterizer: the simulator's no-WebGL2 fallback.
 *
 * Every interactive path renders on the GPU, in the worker, straight from the
 * solver's position texture. This exists for the machines that cannot do that,
 * and for the solver paths the GPU renderer does not cover (a fold profile falls
 * back to the reference solver, which returns positions rather than drawing).
 * It is the only renderer that can draw a frame from a plain position array, so
 * it is kept rather than deleted.
 *
 * Split out of `SimulatorPanel` so that both the panel and inline simulation
 * windows can present a frame without either of them owning ~900 lines of
 * triangle rasterisation.
 */

/** Which creases and faces a sequence step is highlighting, if any. */
export interface SimulatorHighlights {
  creases: Set<number>;
  faces: Set<number>;
}

export const EMPTY_HIGHLIGHTS: SimulatorHighlights = {
  creases: new Set(),
  faces: new Set(),
};

interface ProjectedPoint {
  x: number;
  y: number;
  depth: number;
}

interface ScreenPoint extends ProjectedPoint {
  sx: number;
  sy: number;
}

interface DepthSurface {
  depths: Float32Array;
  width: number;
  height: number;
}

const PAPER_EDGE_DEPTH_EPSILON = 0.006;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** True when a fold carries any non-triangular face, so it needs triangulating. */
export function foldNeedsTriangulation(fold: SimulatorFoldDocument): boolean {
  return fold.faces_vertices.some((face) => face.length !== 3);
}

/**
 * Per-canvas cache for the things `drawFrame` needs but that do not change per
 * frame: drawing-buffer size (layout), palette (computed style), and the
 * framing radius used by the auto-fit.
 *
 * Invalidated by the panel on resize and on theme change. This is deliberately
 * keyed off the canvas element so it survives re-renders and dies with it.
 */
interface SimulatorSurface {
  width: number;
  height: number;
  dpr: number;
  framingRadius: (positions: Float32Array) => number;
}

const surfaceCache = new WeakMap<HTMLCanvasElement, SimulatorSurface>();

export function invalidateSimulatorSurface(
  canvas: HTMLCanvasElement | null,
): void {
  if (canvas) surfaceCache.delete(canvas);
}

function surfaceFor(canvas: HTMLCanvasElement): SimulatorSurface {
  const cached = surfaceCache.get(canvas);
  if (cached) return cached;

  const rect = canvas.getBoundingClientRect();
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  let radius: number | null = null;

  const surface: SimulatorSurface = {
    width: Math.max(360, Math.floor((rect.width || 720) * dpr)),
    height: Math.max(360, Math.floor((rect.height || 720) * dpr)),
    dpr,
    framingRadius: (positions) => {
      // Measured from the first frame after a (re)fit and held, so the folded
      // form shrinks on screen as it actually shrinks.
      radius ??= boundsRadius(positions);
      return radius;
    },
  };
  surfaceCache.set(canvas, surface);
  return surface;
}

export function drawFrame(
  canvas: HTMLCanvasElement,
  model: SimulatorRenderModel,
  frame: SimulatorFrameView,
  view: SimulatorView,
  paint: SimulatorPaint,
  highlights: SimulatorHighlights,
): void {
  // Canvas size is cached rather than read per frame: getBoundingClientRect
  // forces layout, and a 60fps loop was paying for a full flush per frame purely
  // to learn something that only changes on resize. Colours are no longer cached
  // here at all -- they arrive already resolved on `paint`, which the viewport
  // rebuilds when settings or the theme change.
  const surface = surfaceFor(canvas);
  const { width, height, dpr } = surface;
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }

  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const render = paint.render;
  const palette = paletteFrom(paint);

  // clearRect alone already leaves the frame transparent; the fill is what makes
  // it a backdrop, so a transparent surface simply skips it.
  ctx.clearRect(0, 0, width, height);
  if ((render.backgroundAlpha ?? 1) > 0) {
    ctx.fillStyle = palette.canvas;
    ctx.fillRect(0, 0, width, height);
  }

  // Only the canvas-2D path calls this, and only with a frame that carries
  // positions (GPU-render frames are null and drawn by the worker).
  const positions = frame.positions;
  if (!positions) return;

  const projected = projectPositions(positions, view);
  // Shared with the GPU renderer so the two frame a model identically.
  const availableSize = fitExtent(width, height);
  // Framing radius is measured once per model rather than per frame. Refitting
  // every frame made the model visibly "breathe" as it folded -- the sheet gets
  // smaller as it closes, so the auto-fit zoomed in to compensate -- and cost
  // three extra full walks of the position array per draw.
  const scale =
    (availableSize / (2 * surface.framingRadius(positions))) * view.zoom;
  const map = (point: ProjectedPoint) => ({
    x: width / 2 + point.x * scale,
    y: height / 2 - point.y * scale,
  });
  // The erode distance in this frame's pixels — the same sum the GPU pass
  // makes per draw, from the same sheet extent.
  palette.erodePx = erodePx(render, model.sheet, { scale });

  const triangles = triangleOrder(model.indices, projected);
  const xray = render.faceAlpha < 1;
  const faceAlpha = render.faceAlpha;
  const surfaceEdgeAlpha = xray ? 0.5 : 0.92;

  if (!xray && render.showFaces) {
    const depthSurface = drawPaperFacesWithDepth(
      ctx,
      model,
      frame,
      triangles,
      projected,
      map,
      width,
      height,
      palette,
      highlights,
      render.lighting,
    );
    if (depthSurface) {
      if (render.showEdges) {
        drawVisibleEdges(
          ctx,
          model,
          projected,
          map,
          dpr,
          0.94,
          palette,
          highlights,
          depthSurface,
        );
      }
      return;
    }
  }

  for (const triangle of triangles) {
    if (render.showFaces) {
      const highlighted = highlights.faces.has(triangle.faceIndex);
      const a = map(
        projected[triangle.vertices[0]] ?? { x: 0, y: 0, depth: 0 },
      );
      const b = map(
        projected[triangle.vertices[1]] ?? { x: 0, y: 0, depth: 0 },
      );
      const c = map(
        projected[triangle.vertices[2]] ?? { x: 0, y: 0, depth: 0 },
      );
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.lineTo(c.x, c.y);
      ctx.closePath();
      ctx.fillStyle = triangleColor(
        triangle.vertices,
        palette,
        faceAlpha,
        projected,
        render.lighting,
      );
      ctx.fill();
      if (highlighted) {
        ctx.fillStyle = palette.highlightFace;
        ctx.fill();
        ctx.strokeStyle = palette.highlight;
        ctx.globalAlpha = 0.9;
        ctx.lineWidth = Math.max(1.4, dpr * 1.2);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }
    if (render.showEdges && render.showFaces) {
      drawTriangleEdges(
        ctx,
        model,
        triangle,
        projected,
        map,
        dpr,
        surfaceEdgeAlpha,
        palette,
        highlights,
      );
    }
  }

  if (render.showEdges && !render.showFaces) {
    drawAllEdges(ctx, model, projected, map, dpr, 0.95, palette, highlights);
  }
}

export function normalizeVector(vector: { x: number; y: number; z: number }): {
  x: number;
  y: number;
  z: number;
} {
  const length = Math.hypot(vector.x, vector.y, vector.z);
  if (length < 0.0001) return { x: 0, y: 0, z: 1 };
  return {
    x: vector.x / length,
    y: vector.y / length,
    z: vector.z / length,
  };
}

function projectPositions(
  positions: Float32Array,
  view: SimulatorView,
): ProjectedPoint[] {
  const center = boundsCenter(positions);
  const points: ProjectedPoint[] = [];
  // The same matrix the GPU path is handed, rather than a sixth transcription of
  // the yaw/pitch products — a machine without WebGL2 draws through here, and
  // "the fallback is the same view" has to be structural, not remembered.
  const m = viewRotationFor(view);

  for (let index = 0; index < positions.length; index += 3) {
    const dx = (positions[index] ?? 0) - center.x;
    const dy = (positions[index + 1] ?? 0) - center.y;
    const dz = (positions[index + 2] ?? 0) - center.z;
    points.push({
      x: m[0] * dx + m[1] * dy + m[2] * dz,
      y: m[3] * dx + m[4] * dy + m[5] * dz,
      depth: m[6] * dx + m[7] * dy + m[8] * dz,
    });
  }
  return points;
}

// Centroid (mean of vertex positions) rather than the bounding-box midpoint, so
// the orbit pivot and framing sit on the object's visual center. For an
// asymmetric folded shape the bbox midpoint is offset from the mass center,
// which makes the model swing around an off-center point while orbiting.
function boundsCenter(positions: Float32Array): {
  x: number;
  y: number;
  z: number;
} {
  let sumX = 0;
  let sumY = 0;
  let sumZ = 0;
  let count = 0;
  for (let index = 0; index < positions.length; index += 3) {
    sumX += positions[index] ?? 0;
    sumY += positions[index + 1] ?? 0;
    sumZ += positions[index + 2] ?? 0;
    count += 1;
  }
  if (count === 0) return { x: 0, y: 0, z: 0 };
  return { x: sumX / count, y: sumY / count, z: sumZ / count };
}

function boundsRadius(positions: Float32Array): number {
  const center = boundsCenter(positions);
  let radius = 0;
  for (let index = 0; index < positions.length; index += 3) {
    radius = Math.max(
      radius,
      Math.hypot(
        (positions[index] ?? 0) - center.x,
        (positions[index + 1] ?? 0) - center.y,
        (positions[index + 2] ?? 0) - center.z,
      ),
    );
  }
  return Math.max(0.001, radius);
}

interface OrderedTriangle {
  faceIndex: number;
  vertices: [number, number, number];
}

interface SimulatorPalette {
  canvas: string;
  mountain: string;
  valley: string;
  border: string;
  flat: string;
  highlight: string;
  highlightFace: string;
  highlightFaceRgb: Rgb;
  /** The two sides of the paper as 0..1 channels, the form the shade band multiplies. */
  paperFront: Vec3Like;
  paperBack: Vec3Like;
  /** Where the light comes from, in view space; the same vector the GPU and SVG paths shade with. */
  lightDir: Vec3Like;
  /** Device-pixel crease weight, so every path draws the chosen width. */
  creaseWidthPx: number;
  /** Dash runs by crease kind, or null for solid. Same values the shader gets. */
  dash: CreaseDash | undefined;
  /** The auxiliary crease pen, drawn only when {@link showAux}. */
  aux: string;
  auxWidthPx: number;
  showAux: boolean;
  /** How far a flagged crease end retreats, in device px; 0 draws to the ends. */
  erodePx: number;
}

/**
 * The palette this rasterizer indexes into, derived from the shared
 * {@link SimulatorPaint} rather than resolved here.
 *
 * It used to read its own colours from CSS, and disagreed with the GPU and SVG
 * renderers: mountains came from `--status-danger` against their `#db1f24`, and
 * valleys from `--accent-primary` — teal — against their blue. A fold profile
 * forces this path even on a machine with WebGL2, so that was what every segment
 * and sequence-step simulation actually drew.
 */
function paletteFrom(paint: SimulatorPaint): SimulatorPalette {
  const { render, chrome } = paint;
  return {
    canvas: chrome.canvas,
    mountain: renderColorToCss(render.mountainColor),
    valley: renderColorToCss(render.valleyColor),
    border: renderColorToCss(render.borderColor),
    flat: chrome.flat,
    highlight: chrome.highlight,
    highlightFace: "rgb(240 198 116 / 0.3)",
    highlightFaceRgb: chrome.highlightFaceRgb,
    paperFront: render.frontColor,
    paperBack: render.backColor,
    lightDir: render.lightDir,
    creaseWidthPx: render.creaseWidthPx,
    dash: render.creaseDash,
    aux: renderColorToCss(render.auxColor ?? render.borderColor),
    auxWidthPx: render.auxWidthPx ?? render.creaseWidthPx,
    showAux: render.showAux ?? false,
    // Set per frame, once the camera's scale is known.
    erodePx: 0,
  };
}

/**
 * The pen an edge draws with at `widthScale` of its declared width, or null
 * for an edge this pass leaves out: a facet edge, which nothing drew, and an
 * auxiliary crease the style hides. As the GPU edge pass reads the codes.
 */
function edgeInk(
  code: number,
  assignment: string | undefined,
  palette: SimulatorPalette,
  widthScale: number,
): { color: string; width: number; dash: readonly number[] | null } | null {
  if (code === EDGE_CODE.facet) return null;
  if (code === EDGE_CODE.aux) {
    if (!palette.showAux) return null;
    return {
      color: palette.aux,
      width: Math.max(0.5, palette.auxWidthPx * widthScale),
      dash: palette.dash?.aux ?? null,
    };
  }
  return {
    color: edgeColor(assignment, palette),
    width: Math.max(0.5, palette.creaseWidthPx * widthScale),
    dash: edgeDash(assignment, palette),
  };
}

/**
 * Erode (D8) as the painter and the GPU pass apply it: the flagged ends of an
 * edge retreat by the frame's erode distance, in device px, or the edge is
 * dropped when the pull would reach its midpoint. Applied to the whole edge
 * before it is cut into visible pieces — a cut end is nobody's boundary.
 */
function erodeEdge(
  a: { x: number; y: number },
  b: { x: number; y: number },
  flags: number,
  distance: number,
): [{ x: number; y: number }, { x: number; y: number }] | null {
  const eroded = erodeSegment(
    [a.x, a.y],
    [b.x, b.y],
    [(flags & EDGE_BOUNDARY_A) !== 0, (flags & EDGE_BOUNDARY_B) !== 0],
    distance,
  );
  if (!eroded) return null;
  return [
    { x: eroded[0][0], y: eroded[0][1] },
    { x: eroded[1][0], y: eroded[1][1] },
  ];
}

function triangleOrder(
  indices: Uint32Array,
  projected: ProjectedPoint[],
): OrderedTriangle[] {
  const triangles: OrderedTriangle[] = [];
  for (let index = 0; index < indices.length; index += 3) {
    triangles.push({
      faceIndex: Math.floor(index / 3),
      vertices: [
        indices[index] ?? 0,
        indices[index + 1] ?? 0,
        indices[index + 2] ?? 0,
      ],
    });
  }
  return triangles.sort(
    (a, b) => averageDepth(a, projected) - averageDepth(b, projected),
  );
}

function averageDepth(
  triangle: OrderedTriangle,
  projected: ProjectedPoint[],
): number {
  return (
    triangle.vertices.reduce(
      (total, vertex) => total + (projected[vertex]?.depth ?? 0),
      0,
    ) / 3
  );
}

function drawPaperFacesWithDepth(
  ctx: CanvasRenderingContext2D,
  model: SimulatorRenderModel,
  frame: SimulatorFrameView,
  triangles: OrderedTriangle[],
  projected: ProjectedPoint[],
  map: (point: ProjectedPoint) => { x: number; y: number },
  width: number,
  height: number,
  palette: SimulatorPalette,
  highlights: SimulatorHighlights,
  lighting: boolean,
): DepthSurface | null {
  let imageData: ImageData;
  try {
    imageData = ctx.getImageData(0, 0, width, height);
  } catch {
    return null;
  }

  const depths = new Float32Array(width * height);
  depths.fill(-Infinity);

  for (const triangle of triangles) {
    const points = triangle.vertices.map((vertex) => {
      const projectedPoint = projected[vertex] ?? { x: 0, y: 0, depth: 0 };
      const screen = map(projectedPoint);
      return {
        ...projectedPoint,
        sx: screen.x,
        sy: screen.y,
      };
    }) as [ScreenPoint, ScreenPoint, ScreenPoint];
    const color = triangleRasterColor(
      triangle.vertices,
      highlights.faces.has(triangle.faceIndex),
      palette,
      projected,
      lighting,
    );
    rasterizeDepthTriangle(imageData, depths, width, height, points, color);
  }

  ctx.putImageData(imageData, 0, 0);
  return { depths, width, height };
}

function rasterizeDepthTriangle(
  imageData: ImageData,
  depths: Float32Array,
  width: number,
  height: number,
  points: [ScreenPoint, ScreenPoint, ScreenPoint],
  color: [number, number, number, number],
): void {
  const [a, b, c] = points;
  const area = edgeFunction(a, b, c);
  if (Math.abs(area) < 0.0001) return;

  const minX = clamp(Math.floor(Math.min(a.sx, b.sx, c.sx)), 0, width - 1);
  const maxX = clamp(Math.ceil(Math.max(a.sx, b.sx, c.sx)), 0, width - 1);
  const minY = clamp(Math.floor(Math.min(a.sy, b.sy, c.sy)), 0, height - 1);
  const maxY = clamp(Math.ceil(Math.max(a.sy, b.sy, c.sy)), 0, height - 1);
  const data = imageData.data;

  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const sample = { sx: x + 0.5, sy: y + 0.5 };
      const w0 = edgeFunction(b, c, sample);
      const w1 = edgeFunction(c, a, sample);
      const w2 = edgeFunction(a, b, sample);
      const inside =
        area > 0
          ? w0 >= -0.001 && w1 >= -0.001 && w2 >= -0.001
          : w0 <= 0.001 && w1 <= 0.001 && w2 <= 0.001;
      if (!inside) continue;

      const n0 = w0 / area;
      const n1 = w1 / area;
      const n2 = w2 / area;
      const depth = n0 * a.depth + n1 * b.depth + n2 * c.depth;
      const pixelIndex = y * width + x;
      if (depth < (depths[pixelIndex] ?? -Infinity)) continue;

      depths[pixelIndex] = depth;
      const offset = pixelIndex * 4;
      data[offset] = color[0];
      data[offset + 1] = color[1];
      data[offset + 2] = color[2];
      data[offset + 3] = color[3];
    }
  }
}

function edgeFunction(
  a: Pick<ScreenPoint, "sx" | "sy">,
  b: Pick<ScreenPoint, "sx" | "sy">,
  point: Pick<ScreenPoint, "sx" | "sy">,
): number {
  return (point.sx - a.sx) * (b.sy - a.sy) - (point.sy - a.sy) * (b.sx - a.sx);
}

// The paper is two-tone: the colored (front) side shows when a face's screen
// winding matches PAPER_FRONT_WINDING; folded-over faces reveal the light back.
// Flip this if the flat sheet renders white instead of colored.
const PAPER_FRONT_WINDING: 1 | -1 = 1;

function triangleFaceColor(
  triangle: number[],
  projected: ProjectedPoint[],
  palette: SimulatorPalette,
): Vec3Like {
  const a = projected[triangle[0]];
  const b = projected[triangle[1]];
  const c = projected[triangle[2]];
  if (!a || !b || !c) return palette.paperFront;
  const winding = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  return winding * PAPER_FRONT_WINDING >= 0
    ? palette.paperFront
    : palette.paperBack;
}

/**
 * A face's paper colour under the light, as 0..255 channels. The shade band is
 * the one the GPU and SVG renderers use (`shadeFor`), applied the way the
 * framebuffer applies it — multiplied and clamped, so a face square to the
 * light saturates rather than washing toward white.
 */
function triangleShadedRgb(
  triangle: number[],
  projected: ProjectedPoint[],
  palette: SimulatorPalette,
  lighting: boolean,
): Rgb {
  const base = triangleFaceColor(triangle, projected, palette);
  const shade = lighting
    ? shadeFor(triangleNormal(triangle, projected), palette.lightDir)
    : 1;
  return renderColorToRgb(shadeColor(base, shade));
}

function triangleColor(
  triangle: number[],
  palette: SimulatorPalette,
  alpha = 1,
  projected?: ProjectedPoint[],
  lighting = false,
): string {
  const [r, g, b] = projected
    ? triangleShadedRgb(triangle, projected, palette, lighting)
    : renderColorToRgb(palette.paperFront);
  return alpha >= 1 ? `rgb(${r} ${g} ${b})` : `rgb(${r} ${g} ${b} / ${alpha})`;
}

function triangleRasterColor(
  triangle: number[],
  highlighted: boolean,
  palette: SimulatorPalette,
  projected: ProjectedPoint[],
  lighting: boolean,
): [number, number, number, number] {
  const shaded = triangleShadedRgb(triangle, projected, palette, lighting);
  const rgb = highlighted
    ? blendRgb(shaded, palette.highlightFaceRgb, 0.3)
    : shaded;
  return [rgb[0], rgb[1], rgb[2], 255];
}

/**
 * The view-space normal of a projected triangle, unnormalised — `shadeFor`
 * normalises, and treats a sliver's near-zero cross product as unlit.
 */
function triangleNormal(
  triangle: number[],
  projected: ProjectedPoint[],
): Vec3Like {
  const a = projected[triangle[0]];
  const b = projected[triangle[1]];
  const c = projected[triangle[2]];
  if (!a || !b || !c) return [0, 0, 0];
  const ux = b.x - a.x;
  const uy = b.y - a.y;
  const uz = b.depth - a.depth;
  const vx = c.x - a.x;
  const vy = c.y - a.y;
  const vz = c.depth - a.depth;
  return [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
}

function blendRgb(
  base: [number, number, number],
  overlay: [number, number, number],
  alpha: number,
): [number, number, number] {
  return [
    Math.round(base[0] * (1 - alpha) + overlay[0] * alpha),
    Math.round(base[1] * (1 - alpha) + overlay[1] * alpha),
    Math.round(base[2] * (1 - alpha) + overlay[2] * alpha),
  ];
}

function drawTriangleEdges(
  ctx: CanvasRenderingContext2D,
  model: SimulatorRenderModel,
  triangle: OrderedTriangle,
  projected: ProjectedPoint[],
  map: (point: ProjectedPoint) => { x: number; y: number },
  dpr: number,
  alpha: number,
  palette: SimulatorPalette,
  highlights: SimulatorHighlights,
): void {
  const faceEdges = model.facesEdges[triangle.faceIndex] ?? [];
  const pairs: Array<[number, number]> = [
    [triangle.vertices[0], triangle.vertices[1]],
    [triangle.vertices[1], triangle.vertices[2]],
    [triangle.vertices[2], triangle.vertices[0]],
  ];
  ctx.setLineDash([]);
  pairs.forEach(([from, to], side) => {
    drawEdgeSegment(
      ctx,
      model,
      projected,
      map,
      from,
      to,
      faceEdges[side] ?? findEdge(model.edgesVertices, from, to),
      alpha,
      palette,
      highlights,
      dpr,
      0.85,
    );
  });
}

/** Every edge, front and back alike: the wireframe drawn when faces are off. */
function drawAllEdges(
  ctx: CanvasRenderingContext2D,
  model: SimulatorRenderModel,
  projected: ProjectedPoint[],
  map: (point: ProjectedPoint) => { x: number; y: number },
  dpr: number,
  alpha: number,
  palette: SimulatorPalette,
  highlights: SimulatorHighlights,
): void {
  ctx.setLineDash([]);
  // Thinner than the visible-edge pass over faces, which keeps a wireframe of
  // every layer from reading as one solid mass. `drawEdgeSegment` applies each
  // crease kind's own pen and dash pattern per edge.
  model.edgesVertices.forEach((edge, index) => {
    drawEdgeSegment(
      ctx,
      model,
      projected,
      map,
      edge[0],
      edge[1],
      index,
      alpha,
      palette,
      highlights,
      dpr,
      0.7,
    );
  });
  ctx.setLineDash([]);
}

function drawVisibleEdges(
  ctx: CanvasRenderingContext2D,
  model: SimulatorRenderModel,
  projected: ProjectedPoint[],
  map: (point: ProjectedPoint) => { x: number; y: number },
  dpr: number,
  alpha: number,
  palette: SimulatorPalette,
  highlights: SimulatorHighlights,
  depthSurface: DepthSurface,
): void {
  ctx.setLineDash([]);
  model.edgesVertices.forEach((edge, index) => {
    drawVisibleEdgeSegment(
      ctx,
      model,
      projected,
      map,
      edge[0],
      edge[1],
      index,
      alpha,
      palette,
      highlights,
      dpr,
      depthSurface,
    );
  });
}

function drawEdgeSegment(
  ctx: CanvasRenderingContext2D,
  model: SimulatorRenderModel,
  projected: ProjectedPoint[],
  map: (point: ProjectedPoint) => { x: number; y: number },
  from: number,
  to: number,
  edgeIndex: number,
  alpha: number,
  palette: SimulatorPalette,
  highlights: SimulatorHighlights,
  dpr: number,
  widthScale: number,
): void {
  const assignment = model.edgesAssignment[edgeIndex];
  const ink = edgeInk(model.edgeCodes[edgeIndex] ?? EDGE_CODE.border, assignment, palette, widthScale);
  if (!ink) return;
  const ends = erodeEdge(
    map(projected[from] ?? { x: 0, y: 0, depth: 0 }),
    map(projected[to] ?? { x: 0, y: 0, depth: 0 }),
    model.edgeBoundary[edgeIndex] ?? 0,
    palette.erodePx,
  );
  if (!ends) return;
  const [a, b] = ends;
  const highlighted = highlights.creases.has(edgeIndex);
  const previousLineWidth = ctx.lineWidth;
  ctx.lineWidth = ink.width;
  if (!highlighted) applyEdgeDash(ctx, ink.dash);
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.strokeStyle = highlighted ? palette.highlight : ink.color;
  ctx.globalAlpha = highlighted ? 1 : edgeAlpha(assignment, alpha);
  if (highlighted) ctx.lineWidth = Math.max(ctx.lineWidth, dpr * 3);
  ctx.stroke();
  ctx.lineWidth = previousLineWidth;
  ctx.globalAlpha = 1;
}

function drawVisibleEdgeSegment(
  ctx: CanvasRenderingContext2D,
  model: SimulatorRenderModel,
  projected: ProjectedPoint[],
  map: (point: ProjectedPoint) => { x: number; y: number },
  from: number,
  to: number,
  edgeIndex: number,
  alpha: number,
  palette: SimulatorPalette,
  highlights: SimulatorHighlights,
  dpr: number,
  depthSurface: DepthSurface,
): void {
  const assignment = model.edgesAssignment[edgeIndex];
  const ink = edgeInk(model.edgeCodes[edgeIndex] ?? EDGE_CODE.border, assignment, palette, 1);
  if (!ink) return;
  const fromProjected = projected[from] ?? { x: 0, y: 0, depth: 0 };
  const toProjected = projected[to] ?? { x: 0, y: 0, depth: 0 };
  // The whole edge retreats first; the pieces are then cut from what is left,
  // so a cut end never erodes and the erosion is the painter's.
  const ends = erodeEdge(
    map(fromProjected),
    map(toProjected),
    model.edgeBoundary[edgeIndex] ?? 0,
    palette.erodePx,
  );
  if (!ends) return;
  const [a, b] = ends;
  const fullA = map(fromProjected);
  const fullB = map(toProjected);
  const fullLength = Math.hypot(fullB.x - fullA.x, fullB.y - fullA.y);
  // Where each eroded end sits along the uneroded edge, for its depth.
  const along = (point: { x: number; y: number }) =>
    fullLength > 0 ? Math.hypot(point.x - fullA.x, point.y - fullA.y) / fullLength : 0;
  const depthA = fromProjected.depth + (toProjected.depth - fromProjected.depth) * along(a);
  const depthB = fromProjected.depth + (toProjected.depth - fromProjected.depth) * along(b);
  const highlighted = highlights.creases.has(edgeIndex);
  const previousLineWidth = ctx.lineWidth;
  ctx.lineWidth = ink.width;
  if (!highlighted) applyEdgeDash(ctx, ink.dash);
  const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y)));
  let segmentStart: { x: number; y: number } | null = null;
  let previousVisible: { x: number; y: number } | null = null;

  ctx.strokeStyle = highlighted ? palette.highlight : ink.color;
  ctx.globalAlpha = highlighted ? 1 : edgeAlpha(assignment, alpha);
  if (highlighted) ctx.lineWidth = Math.max(ctx.lineWidth, dpr * 3);

  const flushSegment = () => {
    if (!segmentStart || !previousVisible) return;
    ctx.beginPath();
    ctx.moveTo(segmentStart.x, segmentStart.y);
    ctx.lineTo(previousVisible.x, previousVisible.y);
    ctx.stroke();
  };

  for (let step = 0; step <= steps; step += 1) {
    const t = step / steps;
    const point = {
      x: a.x + (b.x - a.x) * t,
      y: a.y + (b.y - a.y) * t,
      depth: depthA + (depthB - depthA) * t,
    };
    if (edgePointIsVisible(point, depthSurface)) {
      segmentStart ??= point;
      previousVisible = point;
    } else {
      flushSegment();
      segmentStart = null;
      previousVisible = null;
    }
  }
  flushSegment();

  ctx.lineWidth = previousLineWidth;
  ctx.globalAlpha = 1;
}

function edgePointIsVisible(
  point: { x: number; y: number; depth: number },
  depthSurface: DepthSurface,
): boolean {
  const x = Math.round(point.x);
  const y = Math.round(point.y);
  if (x < 0 || y < 0 || x >= depthSurface.width || y >= depthSurface.height)
    return false;
  const surfaceDepth = depthSurface.depths[y * depthSurface.width + x];
  if (surfaceDepth === undefined || !Number.isFinite(surfaceDepth)) return true;
  return point.depth >= surfaceDepth - PAPER_EDGE_DEPTH_EPSILON;
}

function findEdge(edges: [number, number][], from: number, to: number): number {
  return edges.findIndex(
    (edge) =>
      (edge[0] === from && edge[1] === to) ||
      (edge[0] === to && edge[1] === from),
  );
}

/** The crease kind's dash pattern, or null for solid. */
function edgeDash(
  assignment: string | undefined,
  palette: SimulatorPalette,
): readonly number[] | null {
  const dash = palette.dash;
  if (!dash) return null;
  return assignment === "M" ? dash.mountain : assignment === "V" ? dash.valley : dash.border;
}

/**
 * Apply an edge's dash pattern.
 *
 * A highlighted crease stays solid: the sequence highlight is a different
 * signal, and dashing it would make it read as a hidden line instead.
 */
function applyEdgeDash(
  ctx: CanvasRenderingContext2D,
  pattern: readonly number[] | null,
): void {
  ctx.setLineDash(pattern ? [...pattern] : []);
}

function edgeColor(
  assignment: string | undefined,
  palette: SimulatorPalette,
): string {
  if (assignment === "M") return palette.mountain;
  if (assignment === "V") return palette.valley;
  if (assignment === "B") return palette.border;
  return palette.flat;
}

function edgeAlpha(assignment: string | undefined, alpha: number): number {
  // An auxiliary crease used to be dimmed here; it draws in its own pen now,
  // at the pass's alpha, as the GPU pass draws it.
  if (!assignment) return alpha * 0.32;
  return alpha;
}