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
import { buildBsp, traverseBsp, type BspItem, type Vec3 } from './bsp.js';
import { findVisiblePieces, type DrawnPiece } from './hiddenPieces.js';
import { coplanarRuns, outlineOf, sourceFaceGroups, type RunPiece } from './coplanarRuns.js';
import { creaseFrameScale, type MeshTopology, type RenderSettings } from './webgl/meshRenderer.js';

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
 * How far toward the eye a crease is nudged, in the NDC depth units the edge
 * shader biases by, so the two agree about when a crease clears its own faces.
 */
const CREASE_DEPTH_BIAS_NDC = 0.0008;

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
  /**
   * Leave out pieces that no pixel of the page shows. On by default, and ignored
   * for translucent paper, which has no hidden geometry to speak of. Off gives
   * the drawing the tree produced, every buried piece included — which is what a
   * test comparing the two wants.
   */
  cullHidden?: boolean;
  /**
   * Draw the pieces of one face as one shape where they are adjacent in the
   * order. On by default. Off gives a polygon per piece, which is what a test
   * comparing the two wants.
   */
  mergeCoplanar?: boolean;
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

/**
 * Settings with the crease width — and the dash runs measured along it — scaled
 * to the frame being drawn, so the rest of this module can work in one unit.
 *
 * No minimum width, unlike the GPU renderer: that floor exists because a
 * sub-pixel ribbon samples erratically, and SVG has no sample grid. A hairline
 * here is simply a hairline, and stays one at whatever size the document is
 * later rasterized to.
 */
function creaseInkForFrame(settings: RenderSettings, camera: CameraUniforms): RenderSettings {
  const scale = creaseFrameScale(settings, camera.width, camera.height);
  if (scale === 1) return settings;
  const runs = (pattern: readonly number[] | null) =>
    pattern ? pattern.map((run) => run * scale) : null;
  return {
    ...settings,
    creaseWidthPx: settings.creaseWidthPx * scale,
    creaseDash: settings.creaseDash && {
      border: runs(settings.creaseDash.border),
      mountain: runs(settings.creaseDash.mountain),
      valley: runs(settings.creaseDash.valley),
    },
    // Already applied; leaving it set would scale a second time if these
    // settings reached another frame-aware renderer.
    creaseWidthReferenceEdge: undefined,
  };
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
  frameSettings: RenderSettings,
  options: RenderMeshToSvgOptions = {}
): SvgRenderResult | null {
  // Resolved once, up front, so every crease measurement below — the BSP's ink
  // allowance, the crop padding, the cap-reach test, the stroke itself — reads
  // the width this frame actually draws at rather than the width a full-size
  // one would. That is what keeps an inline window's export the picture its
  // window shows.
  const settings = creaseInkForFrame(frameSettings, camera);
  const perspective = options.perspective ?? true;
  const projected = projectVertices(positions, camera, { perspective });
  const faces = collectFaces(topology, projected);
  const creases = settings.showEdges ? collectCreases(topology, projected) : [];
  if ((settings.showFaces ? faces.triangles.length : 0) + creases.length === 0) return null;

  // Cut the mesh until a correct back-to-front order exists, then read it off the
  // tree. See `bsp.ts` for why sorting cannot do this.
  //
  // Cut in *screen* space carrying view depth as the third axis, not in view
  // space. Two reasons, and they are the same reason: the vertex shader's
  // perspective is a per-vertex warp of x and y rather than a real projective
  // divide, so a straight segment in view space does not project to a straight
  // line — splitting there and projecting the pieces separately bends a crease
  // visibly at every cut. And this space is exactly what the GPU depth-tests in:
  // `gl_Position.w` stays 1, so the rasterizer interpolates depth linearly across
  // *screen* coordinates, which makes every triangle planar here by construction.
  const items: BspItem[] = [];
  if (settings.showFaces) {
    faces.triangles.forEach((triangle, index) => {
      items.push({
        kind: 0,
        ref: index,
        points: screenPoints(projected, [triangle.a, triangle.b, triangle.c]),
      });
    });
  }
  creases.forEach((crease, index) => {
    // Nudged toward the eye by the same amount the edge shader biases by, and
    // for the same reason: a crease lies exactly on the boundary between two
    // faces, and the nearer of those two is drawn after it. Without the bias
    // that face's edge clips the crease down the middle, so it renders at a
    // fraction of its width — measured at 0.1px of a declared 1.1px on the
    // valley creases of a real model, while the mountains kept 0.9px, purely
    // because of which side each one's nearer face fell on.
    items.push({
      kind: 1,
      ref: index,
      points: screenPoints(projected, [crease.from, crease.to], CREASE_DEPTH_BIAS_NDC * camera.depthRange),
    });
  });
  // Depth is a plain comparison in this space, so the view is orthographic and
  // the eye sits infinitely far along +depth (nearer = larger depth). A crease's
  // ink is measured in page units here, which is what lets the tree leave it
  // whole against a plane it only grazes — see `BuildBspOptions.edgeInk`.
  const eye: Vec3 = [0, 0, Number.MAX_SAFE_INTEGER];
  const ordered = traverseBsp(buildBsp(items, { edgeInk: settings.creaseWidthPx / 2, eye }), eye);

  // The pieces already carry screen coordinates; nothing needs re-projecting.
  const drawnPieces = ordered.map((item) => ({
    item,
    screen: item.points.map(([x, y]) => [x, y] as [number, number]),
  }));
  const bounds = pieceBounds(drawnPieces);
  if (!bounds) return null;

  const padding = Math.max(
    settings.creaseWidthPx,
    Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY) * PADDING_RATIO
  );
  const minX = bounds.minX - padding;
  const minY = bounds.minY - padding;
  const width = bounds.maxX - bounds.minX + padding * 2;
  const height = bounds.maxY - bounds.minY + padding * 2;

  const elements: string[] = [];
  if (options.background !== false) {
    elements.push(
      `  <rect x="${num(minX)}" y="${num(minY)}" width="${num(width)}" height="${num(height)}" ` +
        `fill="${hex(settings.background)}"${opacityAttr('fill', settings.backgroundAlpha ?? 1)}/>`
    );
  }
  const groups = sourceFaceGroups(topology);
  const drawn: (DrawnPiece & RunPiece & { element: string })[] = [];
  for (const { item, screen } of drawnPieces) {
    // A piece is coplanar with the triangle it was cut from, so it takes that
    // triangle's colour and shading rather than recomputing from a sliver.
    const triangle = item.kind === 0 ? faces.triangles[item.ref]! : null;
    const fill = triangle
      ? hex(faceColor(triangle, projected, settings, options.strain ?? null))
      : '';
    const element = triangle
      ? facePolygon(screen, fill, settings)
      : creaseElement(creases[item.ref]!, screen, settings);
    // A dropped sub-pixel piece yields nothing rather than a blank line.
    if (element) {
      drawn.push({
        element,
        points: screen,
        strokeWidth: triangle ? 0 : settings.creaseWidthPx,
        // A crease never merges, and neither does a face whose group is missing.
        group: triangle ? groups[triangle.source] ?? -1 : -1,
        fill,
      });
    }
  }

  // The order says what covers what; it does not say what survives. Pieces buried
  // under later geometry are emitted with the rest unless they are looked for.
  //
  // Only sound while every piece is opaque. Translucent paper shows what is under
  // it, which is the whole point of it, so the pass is skipped there rather than
  // deleting geometry that contributes colour. The face seam hairline is left out
  // of the reckoning too: counting it would let a face occlude a quarter-pixel
  // further than it is drawn, and the error should fall on the side of keeping.
  const opaque = (settings.faceAlpha ?? 1) >= 1;
  const visible =
    options.cullHidden !== false && opaque
      ? findVisiblePieces(drawn, { minX, minY, width, height })
      : null;
  // Merging after culling rather than before, for two reasons: culling reads
  // better on small pieces than on one big outline, and dropping a buried piece
  // can leave two survivors adjacent that were not.
  const survivors = drawn.filter((_, index) => !visible || visible[index]);
  const merged = new Set<number>();
  const mergedElements = new Map<number, string>();
  for (const [start, end] of options.mergeCoplanar === false ? [] : coplanarRuns(survivors)) {
    const run = survivors.slice(start, end);
    const outline = outlineOf(run.map((piece) => piece.points));
    // Null means the run does not resolve to one simple loop, so it goes out as
    // the pieces it already is.
    if (!outline) continue;
    for (let i = start; i < end; i += 1) merged.add(i);
    mergedElements.set(start, facePolygon(outline, run[0]!.fill, settings));
  }
  for (let i = 0; i < survivors.length; i += 1) {
    const replacement = mergedElements.get(i);
    if (replacement) elements.push(replacement);
    else if (!merged.has(i)) elements.push(survivors[i]!.element);
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

interface Triangle {
  a: number;
  b: number;
  c: number;
  /** Index into `faceIndices`, for looking up which source face this came from. */
  source: number;
  depth: number;
  /**
   * Signed screen area, negated so positive means front. Which side of the paper
   * faces the viewer — see the note where it is computed.
   */
  winding: number;
}

interface Crease {
  from: number;
  to: number;
  assignment: number;
}

/**
 * Screen position with view depth as the third axis — the space the BSP cuts in.
 * See the note in {@link renderMeshToSvg}.
 */
function screenPoints(
  projected: ProjectedVertices,
  indices: readonly number[],
  depthBias = 0
): Vec3[] {
  return indices.map((v) => [
    projected.screen[v * 2]!,
    projected.screen[v * 2 + 1]!,
    projected.view[v * 3 + 2]! + depthBias,
  ]);
}

interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** Bounding box of the pieces actually emitted. Null when nothing is drawn. */
function pieceBounds(
  pieces: ReadonlyArray<{ screen: [number, number][] }>
): Bounds | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const { screen } of pieces) {
    for (const [x, y] of screen) {
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY)) return null;
  return { minX, minY, maxX, maxY };
}

/** Triangles worth drawing, with the side of the paper each one shows. */
function collectFaces(
  topology: SvgMeshTopology,
  projected: ProjectedVertices
): { triangles: Triangle[] } {
  const triangles: Triangle[] = [];
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
    // Winding from *screen* space — after the perspective scale — because that is
    // where `gl_FrontFacing` decides it, and negated because pixel y points down
    // while view y points up.
    //
    // View space is not equivalent here. The vertex shader does not do a real
    // perspective divide (it leaves `gl_Position.w` at 1) and instead scales x
    // and y by a per-vertex `camDist/(camDist - depth)`. That is a nonlinear
    // warp, not a projective map, so it can reorder a triangle's vertices —
    // measured at 1-7% of faces on a folded Miura, which showed up as patches of
    // the paper's back side in an export that the GPU drew as front.
    triangles.push({ a, b, c, source: face, depth, winding: -screenArea(projected, a, b, c) });
  }

  return { triangles };
}

/**
 * Creases worth drawing. Border, mountain and valley only — facet edges from
 * triangulation and unassigned edges are skipped, matching `buildEdgeQuads`.
 */
function collectCreases(topology: SvgMeshTopology, projected: ProjectedVertices): Crease[] {
  const creases: Crease[] = [];
  for (let edge = 0; edge < topology.edgeAssignments.length; edge += 1) {
    const assignment = topology.edgeAssignments[edge]!;
    if (assignment !== BORDER && assignment !== MOUNTAIN && assignment !== VALLEY) continue;
    const from = topology.edgeIndices[edge * 2]!;
    const to = topology.edgeIndices[edge * 2 + 1]!;
    if (!screenFinite(projected, from) || !screenFinite(projected, to)) continue;
    creases.push({ from, to, assignment });
  }
  return creases;
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
/**
 * One filled polygon of paper. Takes the fill already resolved, so a merged run
 * and the pieces it replaces are written by the same code.
 */
function facePolygon(
  screen: ReadonlyArray<readonly [number, number]>,
  fill: string,
  settings: RenderSettings
): string {
  const points = screen.map(([x, y]) => `${num(x)},${num(y)}`).join(' ');
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
  screen: readonly [number, number][],
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
  const [from, to] = screen;
  if (!from || !to) return '';
  // Round caps turn a short piece into a dot the width of the stroke, which reads
  // as a blob beside the line rather than part of it. The two pieces either side
  // of a dropped one each reach half a stroke width into the gap it leaves, so a
  // piece shorter than a whole stroke width draws nothing their caps do not
  // already cover. Dashes use butt caps and have no such reach, so they keep the
  // narrower bound.
  const capReach = dash ? settings.creaseWidthPx * 0.5 : settings.creaseWidthPx;
  if (Math.hypot(to[0] - from[0], to[1] - from[1]) < capReach) return '';
  return (
    `  <line x1="${num(from[0])}" y1="${num(from[1])}" ` +
    `x2="${num(to[0])}" y2="${num(to[1])}" ` +
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
