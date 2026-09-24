/**
 * From a {@link PaperStyle} to the `RenderSettings` the simulator's GPU and
 * canvas-2D renderers draw from — the one place a pt becomes a device px and a
 * pen's dash becomes device-px runs. The vector painter reads the style itself,
 * as {@link surfacePaperStyle} shapes it for the surface.
 *
 * Every surface reads the style through a {@link SurfaceStylePolicy}: the table
 * of which fields apply to it and which are forced. The flat folded figure is
 * drawn unlit, arrows exist only on References steps, and so on. The
 * Properties panel shows exactly a policy's `applies`, so what the user can
 * edit and what the renderer honours are the same list by construction.
 */
import type { CreaseDash, RenderSettings } from '@treemaker/origami-simulator';
import {
  DEFAULT_PAPER_STYLE,
  effectivePaperStyle,
  getPaperStyleField,
  ptToDevicePx,
  setPaperStyleField,
  type Hex,
  type PaperStyle,
  type PaperStyleField,
  type PaperStyleOverrides,
  type PaperStyleValue,
  type Pen,
} from './paperStyle';

export type PaperSurface =
  | 'simulator'
  | 'inline-simulation'
  | 'folded-3d'
  | 'folded-flat'
  | 'references';

export interface SurfaceStylePolicy {
  surface: PaperSurface;
  /** The fields this surface reads, and the Properties panel offers. */
  applies: PaperStyleField[];
  /** Values this surface pins regardless of the style. */
  forced?: PaperStyleOverrides;
}

/** What every surface reads: the paper, the edge pen, the aux pen and erode. */
const EVERY_SURFACE_FIELDS: PaperStyleField[] = [
  'paper.front',
  'paper.back',
  'edges',
  'auxCreases.visible',
  'auxCreases.pen',
  'erode',
];

/**
 * A simulation: M/V pens by fold sign unless the style draws its folds as
 * edges, the edge pen for borders, the aux pen for a 0° crease, under the
 * light.
 */
const SIMULATION_FIELDS: PaperStyleField[] = [
  ...EVERY_SURFACE_FIELDS,
  'mountainFolds',
  'valleyFolds',
  'foldsAsEdges',
  'light',
];

/**
 * A folded figure in 3D: the flat figure's pens under the light. Every fold
 * is drawn in the edge pen — a fold that has happened is an edge of the
 * paper, not an instruction — and a 0° crease in the aux pen.
 */
const FOLDED_3D_FIELDS: PaperStyleField[] = [...EVERY_SURFACE_FIELDS, 'light'];

/**
 * The policies. `auxCreases.*` and `erode` apply everywhere since Phase 5,
 * when every renderer learnt to draw them. A crease is drawn by what has
 * happened to it (Phase 9): both folded figures draw their folds as edges,
 * edge + aux (D6); a simulation draws mountain and valley unless its style
 * says `foldsAsEdges`; References draws the fold to make in the M/V pens.
 * `arrows` stays References-only.
 */
export const PAPER_STYLE_POLICIES: Record<PaperSurface, SurfaceStylePolicy> = {
  simulator: { surface: 'simulator', applies: SIMULATION_FIELDS },
  'inline-simulation': { surface: 'inline-simulation', applies: SIMULATION_FIELDS },
  'folded-3d': { surface: 'folded-3d', applies: FOLDED_3D_FIELDS },
  'folded-flat': { surface: 'folded-flat', applies: EVERY_SURFACE_FIELDS },
  // The paper too (D13): a step's sheet is filled with the style's paper, or a
  // black edge pen would vanish on a dark theme's ground. No light (D7).
  references: {
    surface: 'references',
    applies: [...EVERY_SURFACE_FIELDS, 'mountainFolds', 'valleyFolds', 'arrows'],
  },
};

export function policyApplies(policy: SurfaceStylePolicy, field: PaperStyleField): boolean {
  return policy.applies.includes(field);
}

/**
 * The style as a surface sees it: fields the policy does not apply take their
 * defaults, then the policy's forced values go on top. What a surface never
 * reads cannot leak into its drawing through a user's edit to another
 * surface's field.
 */
export function applyPaperStylePolicy(style: PaperStyle, policy: SurfaceStylePolicy): PaperStyle {
  let seen = DEFAULT_PAPER_STYLE;
  for (const field of policy.applies) {
    seen = setPaperStyleField(
      seen,
      field,
      getPaperStyleField(style, field) as PaperStyleValue<typeof field>
    );
  }
  return effectivePaperStyle(seen, policy.forced);
}

/**
 * The style as a surface's renderers draw it, which is what its export must
 * paint with: the policy applied, and every line in its own pen, width
 * included. Where the policy does not apply the fold pens, the folded figures
 * draw every crease with the edge pen, so the fold pens *are* the edge pen.
 * Where a simulation draws its folds as edges, the folds are one kind of line
 * in the edge pen's colour, dash and cap, at the average of the two fold pens'
 * widths — those pens still say how heavy a fold is — while the paper's own
 * edge stays the edge pen exactly. The aux pen is always its own.
 */
export function surfacePaperStyle(style: PaperStyle, policy: SurfaceStylePolicy): PaperStyle {
  const seen = applyPaperStylePolicy(style, policy);
  const edges = seen.edges;
  if (!policyApplies(policy, 'mountainFolds')) {
    return { ...seen, mountainFolds: edges, valleyFolds: edges };
  }
  if (seen.foldsAsEdges && policyApplies(policy, 'foldsAsEdges')) {
    const fold = { ...edges, width: (seen.mountainFolds.width + seen.valleyFolds.width) / 2 };
    return { ...seen, mountainFolds: fold, valleyFolds: fold };
  }
  return seen;
}

export type Vec3 = [number, number, number];

const DEGREES = Math.PI / 180;

/**
 * The light direction in view space (x right, y up, z toward the eye) for a
 * style's angles: `azimuth` degrees clockwise from straight up in the screen
 * plane, `elevation` degrees out of the screen. The result is unit length.
 */
export function lightVector(azimuth: number, elevation: number): Vec3 {
  const inPlane = Math.cos(elevation * DEGREES);
  return [
    inPlane * Math.sin(azimuth * DEGREES),
    inPlane * Math.cos(azimuth * DEGREES),
    Math.sin(elevation * DEGREES),
  ];
}

/** The angles of a view-space direction — the inverse of {@link lightVector}. */
export function lightAngles(direction: Vec3): { azimuth: number; elevation: number } {
  const [x, y, z] = direction;
  const length = Math.hypot(x, y, z) || 1;
  const azimuth = (Math.atan2(x, y) / DEGREES + 360) % 360;
  return { azimuth, elevation: Math.asin(Math.min(1, Math.max(-1, z / length))) / DEGREES };
}

/** `#rrggbb` as 0..1 channels, the form `RenderSettings` carries colours in. */
export function hexToUnitRgb(hex: Hex): Vec3 {
  return [
    Number.parseInt(hex.slice(1, 3), 16) / 255,
    Number.parseInt(hex.slice(3, 5), 16) / 255,
    Number.parseInt(hex.slice(5, 7), 16) / 255,
  ];
}

/** The inverse of {@link hexToUnitRgb}: a 0..1 colour as `#rrggbb`, clamped per channel. */
export function unitRgbToHex(color: readonly [number, number, number]): Hex {
  const channel = (value: number) =>
    Math.round(Math.min(1, Math.max(0, value)) * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${channel(color[0])}${channel(color[1])}${channel(color[2])}`;
}

/** The floor under every resolved line width, in device px: a hairline still shows. */
const MIN_PEN_DEVICE_PX = 0.5;

/** A pen's width in device px, floored at {@link MIN_PEN_DEVICE_PX}. */
function penWidthDevicePx(pen: Pen, dpr: number): number {
  return Math.max(MIN_PEN_DEVICE_PX, ptToDevicePx(pen.width, dpr));
}

/** A pen's dash as device-px runs: its multiples times its device-px width. */
export function penDashDevicePx(pen: Pen, dpr: number): number[] | null {
  if (!pen.dash) return null;
  const widthPx = ptToDevicePx(pen.width, dpr);
  return pen.dash.map((run) => run * widthPx);
}

export interface ResolvePaperStyleOptions {
  /** Device pixel ratio; pens are stated in pt and drawn in device px. */
  dpr: number;
  /** The ground behind the paper, from the theme; the style has no background. */
  background: Vec3;
  /** 0 leaves the frame unpainted so the app's ground shows through. */
  backgroundAlpha: number;
  /** 0..1; below 1 draws faces translucent (x-ray). */
  faceAlpha: number;
  colorMode: RenderSettings['colorMode'];
  strainClip: number;
  /** See `RenderSettings.showFaces` / `showEdges`; both default to drawn. */
  showFaces?: boolean;
  showEdges?: boolean;
  /** See `RenderSettings.creaseWidthReferenceEdge`. */
  creaseWidthReferenceEdge?: number;
  /** See `RenderSettings.creaseWidthShrinkExponent`. */
  creaseWidthShrinkExponent?: number;
}

/**
 * Build the render settings a surface draws from.
 *
 * The pens are the surface's ({@link surfacePaperStyle}), each line at its own
 * pen's width: the edge, the two folds and the aux pen. A surface whose policy
 * leaves out `light` draws unlit. The light direction is data from the style
 * either way, so a lit surface and an unlit one agree on where the light would
 * be.
 *
 * Erode crosses as the style's own unit, a fraction of the sheet: the
 * renderers turn it into pixels per frame from the sheet extent they hold and
 * the camera's scale (`erodePx`), because that scale lives with the camera —
 * in the worker, moved by every zoom — and settings are resolved on a style
 * or theme change, not per frame. A device-px figure here would be right for
 * exactly one zoom.
 */
export function resolvePaperStyle(
  style: PaperStyle,
  policy: SurfaceStylePolicy,
  options: ResolvePaperStyleOptions
): RenderSettings {
  const seen = surfacePaperStyle(style, policy);
  const { dpr } = options;
  const { edges, mountainFolds: mountain, valleyFolds: valley } = seen;
  const aux = seen.auxCreases.pen;
  const dash: CreaseDash = {
    border: penDashDevicePx(edges, dpr),
    mountain: penDashDevicePx(mountain, dpr),
    valley: penDashDevicePx(valley, dpr),
    aux: penDashDevicePx(aux, dpr),
  };
  const anyDash =
    dash.border !== null || dash.mountain !== null || dash.valley !== null || dash.aux !== null;
  return {
    frontColor: hexToUnitRgb(seen.paper.front),
    backColor: hexToUnitRgb(seen.paper.back),
    mountainColor: hexToUnitRgb(mountain.color),
    valleyColor: hexToUnitRgb(valley.color),
    borderColor: hexToUnitRgb(edges.color),
    auxColor: hexToUnitRgb(aux.color),
    // Applied through the policy: a surface that leaves the toggle out sees
    // the default, off.
    showAux: seen.auxCreases.visible,
    auxWidthPx: penWidthDevicePx(aux, dpr),
    erode: seen.erode,
    creaseDash: anyDash ? dash : undefined,
    background: options.background,
    backgroundAlpha: options.backgroundAlpha,
    lightDir: lightVector(seen.light.azimuth, seen.light.elevation),
    showFaces: options.showFaces ?? true,
    showEdges: options.showEdges ?? true,
    lighting: policyApplies(policy, 'light') && seen.light.enabled,
    edgeWidthPx: penWidthDevicePx(edges, dpr),
    mountainWidthPx: penWidthDevicePx(mountain, dpr),
    valleyWidthPx: penWidthDevicePx(valley, dpr),
    creaseWidthReferenceEdge: options.creaseWidthReferenceEdge,
    creaseWidthShrinkExponent: options.creaseWidthShrinkExponent,
    faceAlpha: options.faceAlpha,
    colorMode: options.colorMode,
    strainClip: options.strainClip,
  };
}
