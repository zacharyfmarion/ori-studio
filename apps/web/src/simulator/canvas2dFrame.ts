import type {
  FoldDocument as SimulatorFoldDocument,
  RenderSettings,
} from "@treemaker/origami-simulator";
import type { SimulatorFrameView } from "./useSimulatorRuntime";
import type { SimulatorRenderModel } from "./renderModel";
import type { SimulatorOrbitView as SimulatorView } from "../lib/simulatorOrbit";
import type { SimulatorSettings as SimulatorViewSettings } from "../lib/simulatorSettings";

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

export const PAPER_LIGHT_DIRECTION = normalizeVector({
  x: -0.45,
  y: 0.58,
  z: 0.68,
});

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
  palette: SimulatorPalette;
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
    palette: readSimulatorPalette(canvas),
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
  settings: SimulatorViewSettings,
  highlights: SimulatorHighlights,
): void {
  // Canvas size and palette are cached rather than read per frame. Both used to
  // be recomputed on every draw: getBoundingClientRect forces layout and
  // getComputedStyle forces style recalc, so a 60fps loop was paying for two
  // full style/layout flushes per frame purely to learn things that only change
  // on resize and on theme change.
  const surface = surfaceFor(canvas);
  const { width, height, dpr } = surface;
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }

  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const palette = surface.palette;

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = palette.canvas;
  ctx.fillRect(0, 0, width, height);

  // Only the canvas-2D path calls this, and only with a frame that carries
  // positions (GPU-render frames are null and drawn by the worker).
  const positions = frame.positions;
  if (!positions) return;

  const projected = projectPositions(positions, view);
  const padding = Math.max(28, Math.min(width, height) * 0.08);
  const availableSize = Math.max(1, Math.min(width, height) - padding * 2);
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

  const triangles = triangleOrder(model.indices, projected);
  const faceAlpha = settings.renderMode === "xray" ? 0.48 : 1;
  const surfaceEdgeAlpha = settings.renderMode === "xray" ? 0.5 : 0.92;

  if (settings.renderMode === "paper" && settings.showFaces) {
    if (settings.lighting) {
      drawProjectedPaperShadow(
        ctx,
        triangles,
        projected,
        map,
        width,
        height,
        dpr,
      );
    }
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
      settings.lighting,
    );
    if (depthSurface) {
      if (settings.showEdges) {
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
        if (settings.showHiddenLines) {
          drawAllEdges(
            ctx,
            model,
            projected,
            map,
            dpr,
            0.26,
            true,
            palette,
            highlights,
          );
        }
      }
      return;
    }
  }

  for (const triangle of triangles) {
    if (settings.showFaces) {
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
        settings.lighting,
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
    if (settings.showEdges && settings.showFaces) {
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

  if (settings.showEdges && (!settings.showFaces || settings.showHiddenLines)) {
    drawAllEdges(
      ctx,
      model,
      projected,
      map,
      dpr,
      settings.showFaces ? 0.34 : 0.95,
      settings.showFaces && settings.renderMode === "paper",
      palette,
      highlights,
    );
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
  const cosYaw = Math.cos(view.yaw);
  const sinYaw = Math.sin(view.yaw);
  const cosPitch = Math.cos(view.pitch);
  const sinPitch = Math.sin(view.pitch);

  for (let index = 0; index < positions.length; index += 3) {
    const dx = (positions[index] ?? 0) - center.x;
    const dy = (positions[index + 1] ?? 0) - center.y;
    const dz = (positions[index + 2] ?? 0) - center.z;
    const yawX = cosYaw * dx + sinYaw * dz;
    const yawZ = -sinYaw * dx + cosYaw * dz;
    points.push({
      x: yawX,
      y: cosPitch * yawZ - sinPitch * dy,
      depth: sinPitch * yawZ + cosPitch * dy,
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
  highlightFaceRgb: [number, number, number];
  paperFrontRgb: [number, number, number];
  paperBackRgb: [number, number, number];
}

function parseCssRgb(
  value: string,
  fallback: [number, number, number],
): [number, number, number] {
  const hex = value.trim().replace("#", "");
  if (hex.length === 6) {
    const r = Number.parseInt(hex.slice(0, 2), 16);
    const g = Number.parseInt(hex.slice(2, 4), 16);
    const b = Number.parseInt(hex.slice(4, 6), 16);
    if (Number.isFinite(r) && Number.isFinite(g) && Number.isFinite(b))
      return [r, g, b];
  }
  if (hex.length === 3) {
    const r = Number.parseInt(hex[0]! + hex[0], 16);
    const g = Number.parseInt(hex[1]! + hex[1], 16);
    const b = Number.parseInt(hex[2]! + hex[2], 16);
    if (Number.isFinite(r) && Number.isFinite(g) && Number.isFinite(b))
      return [r, g, b];
  }
  const match = value.match(/-?\d+(\.\d+)?/g);
  if (match && match.length >= 3) {
    return [Number(match[0]), Number(match[1]), Number(match[2])];
  }
  return fallback;
}

function readSimulatorPalette(canvas: HTMLCanvasElement): SimulatorPalette {
  const styles = getComputedStyle(canvas);
  const cssVar = (name: string, fallback: string) =>
    styles.getPropertyValue(name).trim() || fallback;

  return {
    canvas: cssVar("--bg-canvas", "#0c0f12"),
    mountain: cssVar("--status-danger", "#e06c75"),
    valley: cssVar("--accent-primary", "#5fb3a5"),
    border: cssVar("--text-primary", "#e8edf0"),
    flat: cssVar("--text-secondary", "#aeb9bf"),
    highlight: cssVar("--status-warning", "#f0c674"),
    highlightFace: "rgb(240 198 116 / 0.3)",
    highlightFaceRgb: [240, 198, 116],
    paperFrontRgb: parseCssRgb(
      cssVar("--sim-paper-front", "#4f83d6"),
      [79, 131, 214],
    ),
    paperBackRgb: parseCssRgb(
      cssVar("--sim-paper-back", "#f2f0e7"),
      [242, 240, 231],
    ),
  };
}

// Map the panel's view settings + theme palette into the GPU renderer's
// settings. Colours are 0..1 there; the palette is 0..255 / CSS strings.
export function toRenderSettings(
  canvas: HTMLCanvasElement,
  settings: SimulatorViewSettings,
): RenderSettings {
  const palette = readSimulatorPalette(canvas);
  const norm = (rgb: [number, number, number]): [number, number, number] => [
    rgb[0] / 255,
    rgb[1] / 255,
    rgb[2] / 255,
  ];
  // Mountain/valley use fixed origami-convention colours (red / blue) rather
  // than theme tokens, so they stay high-contrast in both themes. They read
  // clearly now that the paper front is gray (--sim-paper-front). Border stays
  // theme-derived (a quiet outline).
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  return {
    frontColor: norm(palette.paperFrontRgb),
    backColor: norm(palette.paperBackRgb),
    mountainColor: [0.86, 0.12, 0.14],
    valleyColor: [0.11, 0.36, 0.85],
    borderColor: norm(parseCssRgb(palette.border, [232, 237, 240])),
    background: norm(parseCssRgb(palette.canvas, [12, 15, 18])),
    lightDir: [
      PAPER_LIGHT_DIRECTION.x,
      PAPER_LIGHT_DIRECTION.y,
      PAPER_LIGHT_DIRECTION.z,
    ],
    showFaces: settings.showFaces,
    showEdges: settings.showEdges,
    lighting: settings.lighting,
    creaseWidthPx: Math.max(1, Math.round(1.1 * dpr)),
    faceAlpha: settings.renderMode === "xray" ? 0.48 : 1,
    colorMode: settings.colorMode,
    strainClip: settings.strainClip,
  };
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

function drawProjectedPaperShadow(
  ctx: CanvasRenderingContext2D,
  triangles: OrderedTriangle[],
  projected: ProjectedPoint[],
  map: (point: ProjectedPoint) => { x: number; y: number },
  width: number,
  height: number,
  dpr: number,
): void {
  const size = Math.min(width, height);
  const shadowOffset = Math.max(5 * dpr, size * 0.018);
  const shadowBlur = Math.max(10 * dpr, size * 0.03);
  ctx.save();
  ctx.shadowColor = "rgba(0, 0, 0, 0.24)";
  ctx.shadowBlur = shadowBlur;
  ctx.shadowOffsetX = shadowOffset;
  ctx.shadowOffsetY = shadowOffset * 1.15;
  ctx.fillStyle = "rgba(0, 0, 0, 0.08)";
  ctx.beginPath();

  for (const triangle of triangles) {
    const a = map(projected[triangle.vertices[0]] ?? { x: 0, y: 0, depth: 0 });
    const b = map(projected[triangle.vertices[1]] ?? { x: 0, y: 0, depth: 0 });
    const c = map(projected[triangle.vertices[2]] ?? { x: 0, y: 0, depth: 0 });
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.lineTo(c.x, c.y);
    ctx.closePath();
  }

  ctx.fill();
  ctx.restore();
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

function triangleFaceRgb(
  triangle: number[],
  projected: ProjectedPoint[],
  palette: SimulatorPalette,
): [number, number, number] {
  const a = projected[triangle[0]];
  const b = projected[triangle[1]];
  const c = projected[triangle[2]];
  if (!a || !b || !c) return palette.paperFrontRgb;
  const winding = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  return winding * PAPER_FRONT_WINDING >= 0
    ? palette.paperFrontRgb
    : palette.paperBackRgb;
}

function triangleColor(
  triangle: number[],
  palette: SimulatorPalette,
  alpha = 1,
  projected?: ProjectedPoint[],
  lighting = false,
): string {
  const base = projected
    ? triangleFaceRgb(triangle, projected, palette)
    : palette.paperFrontRgb;
  const [r, g, b] =
    lighting && projected
      ? shadeRgb(base, triangleLightIntensity(triangle, projected))
      : base;
  return alpha >= 1 ? `rgb(${r} ${g} ${b})` : `rgb(${r} ${g} ${b} / ${alpha})`;
}

function triangleRasterColor(
  triangle: number[],
  highlighted: boolean,
  palette: SimulatorPalette,
  projected: ProjectedPoint[],
  lighting: boolean,
): [number, number, number, number] {
  const base = triangleFaceRgb(triangle, projected, palette);
  const shaded = lighting
    ? shadeRgb(base, triangleLightIntensity(triangle, projected))
    : base;
  const rgb = highlighted
    ? blendRgb(shaded, palette.highlightFaceRgb, 0.3)
    : shaded;
  return [rgb[0], rgb[1], rgb[2], 255];
}

function triangleLightIntensity(
  triangle: number[],
  projected: ProjectedPoint[],
): number {
  const a = projected[triangle[0]];
  const b = projected[triangle[1]];
  const c = projected[triangle[2]];
  if (!a || !b || !c) return 1;
  const normal = triangleNormal(a, b, c);
  if (!normal) return 1;
  const oriented =
    normal.z < 0 ? { x: -normal.x, y: -normal.y, z: -normal.z } : normal;
  const diffuse = Math.max(0, dotVector(oriented, PAPER_LIGHT_DIRECTION));
  return clamp(0.74 + diffuse * 0.3 + oriented.z * 0.04, 0.68, 1.08);
}

function triangleNormal(
  a: ProjectedPoint,
  b: ProjectedPoint,
  c: ProjectedPoint,
): { x: number; y: number; z: number } | null {
  const ux = b.x - a.x;
  const uy = b.y - a.y;
  const uz = b.depth - a.depth;
  const vx = c.x - a.x;
  const vy = c.y - a.y;
  const vz = c.depth - a.depth;
  const normal = {
    x: uy * vz - uz * vy,
    y: uz * vx - ux * vz,
    z: ux * vy - uy * vx,
  };
  const length = Math.hypot(normal.x, normal.y, normal.z);
  if (length < 0.0001) return null;
  return {
    x: normal.x / length,
    y: normal.y / length,
    z: normal.z / length,
  };
}

function dotVector(
  a: { x: number; y: number; z: number },
  b: { x: number; y: number; z: number },
): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function shadeRgb(
  color: [number, number, number],
  intensity: number,
): [number, number, number] {
  if (intensity <= 1) {
    return [
      Math.round(color[0] * intensity),
      Math.round(color[1] * intensity),
      Math.round(color[2] * intensity),
    ];
  }
  const lift = Math.min(0.16, intensity - 1);
  return [
    Math.round(color[0] + (255 - color[0]) * lift),
    Math.round(color[1] + (255 - color[1]) * lift),
    Math.round(color[2] + (255 - color[2]) * lift),
  ];
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
  ctx.lineWidth = Math.max(1.2, dpr * 1.05);
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
    );
  });
}

function drawAllEdges(
  ctx: CanvasRenderingContext2D,
  model: SimulatorRenderModel,
  projected: ProjectedPoint[],
  map: (point: ProjectedPoint) => { x: number; y: number },
  dpr: number,
  alpha: number,
  dashed: boolean,
  palette: SimulatorPalette,
  highlights: SimulatorHighlights,
): void {
  ctx.setLineDash(dashed ? [Math.max(3, dpr * 3), Math.max(3, dpr * 3)] : []);
  ctx.lineWidth = Math.max(1.5, dpr * 1.25);
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
  ctx.lineWidth = Math.max(1.5, dpr * 1.25);
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
): void {
  const a = map(projected[from] ?? { x: 0, y: 0, depth: 0 });
  const b = map(projected[to] ?? { x: 0, y: 0, depth: 0 });
  const assignment = model.edgesAssignment[edgeIndex];
  const highlighted = highlights.creases.has(edgeIndex);
  const previousLineWidth = ctx.lineWidth;
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.strokeStyle = highlighted
    ? palette.highlight
    : edgeColor(assignment, palette);
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
  const fromProjected = projected[from] ?? { x: 0, y: 0, depth: 0 };
  const toProjected = projected[to] ?? { x: 0, y: 0, depth: 0 };
  const a = map(fromProjected);
  const b = map(toProjected);
  const assignment = model.edgesAssignment[edgeIndex];
  const highlighted = highlights.creases.has(edgeIndex);
  const previousLineWidth = ctx.lineWidth;
  const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y)));
  let segmentStart: { x: number; y: number } | null = null;
  let previousVisible: { x: number; y: number } | null = null;

  ctx.strokeStyle = highlighted
    ? palette.highlight
    : edgeColor(assignment, palette);
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
      depth:
        fromProjected.depth + (toProjected.depth - fromProjected.depth) * t,
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
  if (assignment === "F") return alpha * 0.55;
  if (!assignment) return alpha * 0.32;
  return alpha;
}