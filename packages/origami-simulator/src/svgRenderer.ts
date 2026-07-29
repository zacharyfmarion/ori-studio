// Draws the folded mesh to SVG, as the vector counterpart of `MeshRenderer`.
//
// Same inputs as that renderer -- positions, the same `MeshTopology`, the same
// `CameraUniforms`, the same `RenderSettings` -- so the output is the view the
// user is looking at rather than a second interpretation of it. Where the GPU
// path has a depth buffer this has a painter's sort, which is the one real
// difference and the one documented limitation (see `depthOrder` below).
//
// Deliberately free of DOM, theme and app concerns: colours arrive already
// resolved on `RenderSettings`, the caller having read them from CSS once. That
// is what makes this a pure function of the render state and testable without a
// browser.
import { projectVertices, type CameraUniforms, type ProjectedVertices } from './webgl/camera.js';
import type { MeshTopology, RenderSettings } from './webgl/meshRenderer.js';

/** Edge assignment codes, matching `EDGE_ASSIGNMENT_CODES` and the edge shader. */
const BORDER = 0;
const MOUNTAIN = 1;
const VALLEY = 2;

/**
 * Screen area below which a triangle is dropped.
 *
 * A zero-area triangle is the signature of a solver NaN reaching the renderer
 * (see `prepareFoldModel`'s guard), and it also cannot cover a pixel, so
 * emitting it would add an invisible degenerate polygon per occurrence.
 */
const MIN_SCREEN_AREA = 1e-6;

/** Padding around the cropped artwork, as a fraction of its longest edge. */
const PADDING_RATIO = 0.02;

/**
 * Hairline stroke on each opaque face, in its own fill colour.
 *
 * SVG renderers antialias adjacent polygon edges independently, which leaves a
 * visible seam grid across a dense mesh where the two coverages do not sum to
 * one. Stroking each face in its own colour closes the seam without changing
 * the colour. Skipped for translucent faces, where a doubled stroke would
 * darken every shared edge instead.
 */
const SEAM_STROKE_WIDTH = 0.5;

export interface RenderMeshToSvgOptions {
  /**
   * Apply the perspective divide. True (the default) matches the WebGL
   * renderer; false matches the orthographic canvas-2D fallback.
   */
  perspective?: boolean;
  /**
   * Per-vertex mean axial strain, from `SolverBackend.readStrain`. Required for
   * `colorMode: 'strain'`; the paper two-tone is used when it is absent.
   */
  strain?: Float32Array | null;
  /** Paint {@link RenderSettings.background}. Off leaves the page transparent. */
  background?: boolean;
}

/**
 * What a vector renderer needs of {@link MeshTopology}: everything except the
 * solver's texture edge, which is how the vertex shader finds a position and
 * means nothing here. A full `MeshTopology` satisfies this.
 */
export type SvgMeshTopology = Omit<MeshTopology, 'textureDim'>;

export interface SvgRenderResult {
  svg: string;
  /** Page size in the same device pixels the camera is measured in. */
  width: number;
  height: number;
}

/** One thing to paint, at the depth it is painted at. */
interface DrawItem {
  depth: number;
  /** Faces sort ahead of creases at equal depth -- see {@link depthOrder}. */
  kind: 0 | 1;
  index: number;
}

/**
 * Serialize the current view to a standalone SVG document, cropped to the
 * artwork. Null when nothing would be drawn: an empty model, or faces and
 * creases both switched off.
 */
export function renderMeshToSvg(
  positions: Float32Array,
  topology: SvgMeshTopology,
  camera: CameraUniforms,
  settings: RenderSettings,
  options: RenderMeshToSvgOptions = {}
): SvgRenderResult | null {
  const projected = projectVertices(positions, camera, { perspective: options.perspective });
  const faces = collectFaces(topology, projected);
  const creases = settings.showEdges ? collectCreases(topology, projected, faces.depthByEdgeKey) : [];
  const drawn = [
    ...(settings.showFaces ? faces.items : []),
    ...creases.map((crease, index): DrawItem => ({ depth: crease.depth, kind: 1, index })),
  ];
  if (drawn.length === 0) return null;

  const bounds = artworkBounds(
    projected,
    settings.showFaces ? faces.triangles : [],
    creases
  );
  if (!bounds) return null;

  const padding = Math.max(
    settings.creaseWidthPx,
    Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY) * PADDING_RATIO
  );
  const minX = bounds.minX - padding;
  const minY = bounds.minY - padding;
  const width = bounds.maxX - bounds.minX + padding * 2;
  const height = bounds.maxY - bounds.minY + padding * 2;

  drawn.sort(depthOrder);

  const elements: string[] = [];
  if (options.background !== false) {
    elements.push(
      `  <rect x="${num(minX)}" y="${num(minY)}" width="${num(width)}" height="${num(height)}" ` +
        `fill="${hex(settings.background)}"${opacityAttr('fill', settings.backgroundAlpha ?? 1)}/>`
    );
  }
  for (const item of drawn) {
    elements.push(
      item.kind === 0
        ? faceElement(faces.triangles[item.index]!, projected, settings, options.strain ?? null)
        : creaseElement(creases[item.index]!, projected, settings)
    );
  }

  const svg = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<svg xmlns="http://www.w3.org/2000/svg" width="${num(width)}" height="${num(height)}" ` +
      `viewBox="${num(minX)} ${num(minY)} ${num(width)} ${num(height)}" role="img" aria-label="Folded model">`,
    '  <g stroke-linecap="round" stroke-linejoin="round">',
    ...elements,
    '  </g>',
    '</svg>',
  ].join('\n');

  return { svg, width, height };
}

/**
 * Painter's order: farthest first.
 *
 * `depth` grows toward the eye (see {@link ProjectedVertices}), so ascending
 * depth paints back to front. Faces precede creases at equal depth, which is
 * what puts a crease on top of the face it lies on -- a crease takes the depth
 * of the *nearer* of its two adjacent faces, so the tie is with that face.
 *
 * A mean-depth sort cannot order interpenetrating or mutually overlapping
 * triangles, and a folded model is mostly stacked near-coplanar layers, so some
 * views will place a layer differently from the GPU's per-pixel depth test.
 * That is inherent to flattening to vector polygons.
 */
function depthOrder(left: DrawItem, right: DrawItem): number {
  return left.depth - right.depth || left.kind - right.kind;
}

interface Triangle {
  a: number;
  b: number;
  c: number;
  depth: number;
  /** Signed area in view space, whose sign is which side of the paper faces us. */
  winding: number;
}

interface Crease {
  from: number;
  to: number;
  assignment: number;
  depth: number;
}

/**
 * Triangles worth drawing, plus the depth of the nearest triangle on each
 * vertex pair — which is what gives a crease its depth without needing a
 * face-to-edge table.
 */
function collectFaces(
  topology: SvgMeshTopology,
  projected: ProjectedVertices
): { triangles: Triangle[]; items: DrawItem[]; depthByEdgeKey: Map<number, number> } {
  const triangles: Triangle[] = [];
  const items: DrawItem[] = [];
  const depthByEdgeKey = new Map<number, number>();
  const faceCount = Math.floor(topology.faceIndices.length / 3);

  for (let face = 0; face < faceCount; face += 1) {
    const a = topology.faceIndices[face * 3]!;
    const b = topology.faceIndices[face * 3 + 1]!;
    const c = topology.faceIndices[face * 3 + 2]!;
    if (!screenFinite(projected, a) || !screenFinite(projected, b) || !screenFinite(projected, c)) {
      continue;
    }
    if (Math.abs(screenArea(projected, a, b, c)) < MIN_SCREEN_AREA) continue;

    const depth =
      (projected.view[a * 3 + 2]! + projected.view[b * 3 + 2]! + projected.view[c * 3 + 2]!) / 3;
    // Winding from view space rather than screen space: it is the same quantity
    // the canvas-2D renderer tests, and pixel y points the other way, so mixing
    // the two would silently swap the paper's two sides.
    items.push({ depth, kind: 0, index: triangles.length });
    triangles.push({ a, b, c, depth, winding: viewArea(projected, a, b, c) });

    // Creases sit on the nearest face they belong to, so a crease under another
    // layer is painted before that layer covers it.
    for (const [from, to] of [
      [a, b],
      [b, c],
      [c, a],
    ] as ReadonlyArray<readonly [number, number]>) {
      const key = edgeKey(from, to, projected.count);
      const existing = depthByEdgeKey.get(key);
      if (existing === undefined || depth > existing) depthByEdgeKey.set(key, depth);
    }
  }

  // The walk runs even with faces hidden: it is what gives creases their depths,
  // and a crease-only view still has to occlude correctly. The caller decides
  // whether the faces themselves get painted.
  return { triangles, items, depthByEdgeKey };
}

/**
 * Creases worth drawing. Border, mountain and valley only — facet edges from
 * triangulation and unassigned edges are skipped, matching `buildEdgeQuads`.
 */
function collectCreases(
  topology: SvgMeshTopology,
  projected: ProjectedVertices,
  depthByEdgeKey: Map<number, number>
): Crease[] {
  const creases: Crease[] = [];
  for (let edge = 0; edge < topology.edgeAssignments.length; edge += 1) {
    const assignment = topology.edgeAssignments[edge]!;
    if (assignment !== BORDER && assignment !== MOUNTAIN && assignment !== VALLEY) continue;
    const from = topology.edgeIndices[edge * 2]!;
    const to = topology.edgeIndices[edge * 2 + 1]!;
    if (!screenFinite(projected, from) || !screenFinite(projected, to)) continue;
    // Falls back to the edge's own nearer end when no triangle claimed it, which
    // a well-formed mesh never hits but a partial one would.
    const depth =
      depthByEdgeKey.get(edgeKey(from, to, projected.count)) ??
      Math.max(projected.view[from * 3 + 2]!, projected.view[to * 3 + 2]!);
    creases.push({ from, to, assignment, depth });
  }
  return creases;
}

/** Order-independent key for a vertex pair. */
function edgeKey(from: number, to: number, count: number): number {
  return from < to ? from * count + to : to * count + from;
}

function screenFinite(projected: ProjectedVertices, vertex: number): boolean {
  return (
    Number.isFinite(projected.screen[vertex * 2]) &&
    Number.isFinite(projected.screen[vertex * 2 + 1])
  );
}

function screenArea(projected: ProjectedVertices, a: number, b: number, c: number): number {
  const ax = projected.screen[a * 2]!;
  const ay = projected.screen[a * 2 + 1]!;
  return (
    ((projected.screen[b * 2]! - ax) * (projected.screen[c * 2 + 1]! - ay) -
      (projected.screen[b * 2 + 1]! - ay) * (projected.screen[c * 2]! - ax)) /
    2
  );
}

function viewArea(projected: ProjectedVertices, a: number, b: number, c: number): number {
  const ax = projected.view[a * 3]!;
  const ay = projected.view[a * 3 + 1]!;
  return (
    (projected.view[b * 3]! - ax) * (projected.view[c * 3 + 1]! - ay) -
    (projected.view[b * 3 + 1]! - ay) * (projected.view[c * 3]! - ax)
  );
}

interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

function artworkBounds(
  projected: ProjectedVertices,
  triangles: readonly Triangle[],
  creases: readonly Crease[]
): Bounds | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const include = (vertex: number) => {
    const x = projected.screen[vertex * 2]!;
    const y = projected.screen[vertex * 2 + 1]!;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  };
  for (const triangle of triangles) {
    include(triangle.a);
    include(triangle.b);
    include(triangle.c);
  }
  for (const crease of creases) {
    include(crease.from);
    include(crease.to);
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY)) return null;
  return { minX, minY, maxX, maxY };
}

/**
 * The paper's coloured side shows when the triangle's view winding is positive;
 * folded-over faces reveal the light back. Same rule and same orientation as the
 * canvas-2D renderer's `PAPER_FRONT_WINDING`, so the two agree about which side
 * is which.
 */
function faceElement(
  triangle: Triangle,
  projected: ProjectedVertices,
  settings: RenderSettings,
  strain: Float32Array | null
): string {
  const points = [triangle.a, triangle.b, triangle.c]
    .map(
      (vertex) => `${num(projected.screen[vertex * 2]!)},${num(projected.screen[vertex * 2 + 1]!)}`
    )
    .join(' ');
  const fill = hex(faceColor(triangle, projected, settings, strain));
  // Opaque faces close their own antialiasing seams; translucent ones must not,
  // or every shared edge doubles up and reads as a wireframe.
  const seam =
    settings.faceAlpha >= 1
      ? ` stroke="${fill}" stroke-width="${num(SEAM_STROKE_WIDTH)}"`
      : ' stroke="none"';
  return `  <polygon points="${points}" fill="${fill}"${opacityAttr('fill', settings.faceAlpha)}${seam}/>`;
}

function faceColor(
  triangle: Triangle,
  projected: ProjectedVertices,
  settings: RenderSettings,
  strain: Float32Array | null
): readonly [number, number, number] {
  if (settings.colorMode === 'strain' && strain) {
    // Flat-shaded, as the face shader is in strain mode: lighting would read as
    // strain that is not there. The mean of the three vertices is what the shader
    // interpolates to at the triangle's centre.
    const mean =
      ((strain[triangle.a] ?? 0) + (strain[triangle.b] ?? 0) + (strain[triangle.c] ?? 0)) / 3;
    return strainColor(mean, settings.strainClip ?? 5);
  }
  const base = triangle.winding >= 0 ? settings.frontColor : settings.backColor;
  return settings.lighting ? shade(base, lightIntensity(triangle, projected, settings)) : base;
}

/**
 * Percent strain, clipped, mapped hue 0.7 (blue, relaxed) to 0 (red, at the
 * clip) — upstream's `scaledVal = (1 - e/clip) * 0.7` through
 * `THREE.Color.setHSL(hue, 1, 0.5)`, which is the `hueToRgb` the face shader
 * inlines.
 */
function strainColor(fraction: number, clip: number): [number, number, number] {
  const percent = Math.min(fraction * 100, clip);
  const hue = clampUnit((1 - percent / Math.max(clip, 0.0001)) * 0.7);
  const channel = (offset: number) => clampUnit(2 - Math.abs(hue * 6 - offset));
  return [clampUnit(Math.abs(hue * 6 - 3) - 1), channel(2), channel(4)];
}

/**
 * The face shader's flat lighting: the triangle's geometric normal in view
 * space, oriented toward the viewer, against the light direction.
 */
function lightIntensity(
  triangle: Triangle,
  projected: ProjectedVertices,
  settings: RenderSettings
): number {
  const at = (vertex: number) =>
    [
      projected.view[vertex * 3]!,
      projected.view[vertex * 3 + 1]!,
      projected.view[vertex * 3 + 2]!,
    ] as const;
  const [ax, ay, az] = at(triangle.a);
  const [bx, by, bz] = at(triangle.b);
  const [cx, cy, cz] = at(triangle.c);
  const ux = bx - ax;
  const uy = by - ay;
  const uz = bz - az;
  const vx = cx - ax;
  const vy = cy - ay;
  const vz = cz - az;
  let nx = uy * vz - uz * vy;
  let ny = uz * vx - ux * vz;
  let nz = ux * vy - uy * vx;
  const length = Math.hypot(nx, ny, nz);
  if (length < 0.0001) return 1;
  nx /= length;
  ny /= length;
  nz /= length;
  if (nz < 0) {
    nx = -nx;
    ny = -ny;
    nz = -nz;
  }
  const [lx, ly, lz] = settings.lightDir;
  const lightLength = Math.hypot(lx, ly, lz) || 1;
  const diffuse = Math.max(0, (nx * lx + ny * ly + nz * lz) / lightLength);
  return Math.min(1.08, Math.max(0.68, 0.74 + diffuse * 0.3 + nz * 0.04));
}

/** Multiply below 1, lift toward white above it — the shader's `base*shade`. */
function shade(
  color: readonly [number, number, number],
  intensity: number
): [number, number, number] {
  return [
    clampUnit(color[0] * intensity),
    clampUnit(color[1] * intensity),
    clampUnit(color[2] * intensity),
  ];
}

function creaseElement(
  crease: Crease,
  projected: ProjectedVertices,
  settings: RenderSettings
): string {
  const color =
    crease.assignment === MOUNTAIN
      ? settings.mountainColor
      : crease.assignment === VALLEY
        ? settings.valleyColor
        : settings.borderColor;
  const dash = dashFor(crease.assignment, settings);
  // `stroke-dasharray` takes the same alternating on/off runs the shader and
  // setLineDash do, in the same device pixels, so all three dash alike.
  //
  // Butt caps override the group's round ones: a round cap extends every run by
  // half the stroke width at both ends, which closes the small gaps in a
  // dash-dot pattern and turns its dots into lozenges.
  const dashAttr = dash
    ? ` stroke-dasharray="${dash.map(num).join(' ')}" stroke-linecap="butt"`
    : '';
  return (
    `  <line x1="${num(projected.screen[crease.from * 2]!)}" y1="${num(projected.screen[crease.from * 2 + 1]!)}" ` +
    `x2="${num(projected.screen[crease.to * 2]!)}" y2="${num(projected.screen[crease.to * 2 + 1]!)}" ` +
    `stroke="${hex(color)}" stroke-width="${num(settings.creaseWidthPx)}"${dashAttr}/>`
  );
}

function dashFor(assignment: number, settings: RenderSettings): readonly number[] | null {
  const dash = settings.creaseDash;
  if (!dash) return null;
  const pattern =
    assignment === MOUNTAIN ? dash.mountain : assignment === VALLEY ? dash.valley : dash.border;
  return pattern && pattern.length > 0 ? pattern : null;
}

function clampUnit(value: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
}

/** A 0..1 colour triple as `#rrggbb`. */
function hex(color: readonly [number, number, number]): string {
  const channel = (value: number) =>
    Math.round(clampUnit(value) * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${channel(color[0])}${channel(color[1])}${channel(color[2])}`;
}

/** Emitted only below 1, so a fully opaque document carries no opacity noise. */
function opacityAttr(property: 'fill' | 'stroke', alpha: number): string {
  return alpha >= 1 ? '' : ` ${property}-opacity="${num(alpha)}"`;
}

function num(value: number): string {
  return Number.isFinite(value) ? value.toFixed(2) : '0';
}
