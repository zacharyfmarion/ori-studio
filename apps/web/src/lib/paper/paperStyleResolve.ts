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
 * A surface that draws its folds as the simulator does: M/V pens by fold sign,
 * the edge pen for borders, the aux pen for a 0° crease, under the light.
 */
const SIMULATION_FIELDS: PaperStyleField[] = [
  ...EVERY_SURFACE_FIELDS,
  'mountainFolds',
  'valleyFolds',
  'light',
];

/**
 * The policies. `auxCreases.*` and `erode` apply everywhere since Phase 5,
 * when every renderer learnt to draw them; the flat figure stays edge + aux
 * (D6: it has no visible M/V); `arrows` stays References-only.
 */
export const PAPER_STYLE_POLICIES: Record<PaperSurface, SurfaceStylePolicy> = {
  simulator: { surface: 'simulator', applies: SIMULATION_FIELDS },
  'inline-simulation': { surface: 'inline-simulation', applies: SIMULATION_FIELDS },
  'folded-3d': { surface: 'folded-3d', applies: SIMULATION_FIELDS },
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
 * paint with. The policy applied, and then one width for every fold line:
 * `RenderSettings` carries a single crease width, and the GPU and canvas-2D
 * renderers draw border, mountain and valley ribbons at it. Where the policy
 * applies the fold pens that width is the mountain pen's — the simulator's
 * "Fold line weight" — and the edge and valley pens take it here; where it does
 * not, the flat figure draws every crease with the edge pen, so the fold pens
 * *are* the edge pen. The aux pen is its own: the renderers draw it at its
 * width (`auxWidthPx`). A painter handed this style writes the widths the
 * screen showed rather than the ones the style states.
 */
export function surfacePaperStyle(style: PaperStyle, policy: SurfaceStylePolicy): PaperStyle {
  const seen = applyPaperStylePolicy(style, policy);
  const edges = seen.edges;
  if (!policyApplies(policy, 'mountainFolds')) {
    return { ...seen, mountainFolds: edges, valleyFolds: edges };
  }
  const width = seen.mountainFolds.width;
  const valley = policyApplies(policy, 'valleyFolds') ? seen.valleyFolds : edges;
  return { ...seen, edges: { ...edges, width }, valleyFolds: { ...valley, width } };
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
 * The pens are the surface's ({@link surfacePaperStyle}): one width for every
 * fold line, the mountain pen's where the policy applies fold pens and the edge
 * pen's where it does not (the flat figure, whose creases are all drawn in the
 * line colour), and the aux pen at its own. A surface whose policy leaves out
 * `light` draws unlit. The light direction is data from the style either way,
 * so a lit surface and an unlit one agree on where the light would be.
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
    auxWidthPx: Math.max(0.5, ptToDevicePx(aux.width, dpr)),
    erode: seen.erode,
    creaseDash: anyDash ? dash : undefined,
    background: options.background,
    backgroundAlpha: options.backgroundAlpha,
    lightDir: lightVector(seen.light.azimuth, seen.light.elevation),
    showFaces: options.showFaces ?? true,
    showEdges: options.showEdges ?? true,
    lighting: policyApplies(policy, 'light') && seen.light.enabled,
    // Every pen is at one width here; the floor keeps a hairline pen from
    // vanishing on a standard display.
    creaseWidthPx: Math.max(0.5, ptToDevicePx(edges.width, dpr)),
    creaseWidthReferenceEdge: options.creaseWidthReferenceEdge,
    creaseWidthShrinkExponent: options.creaseWidthShrinkExponent,
    faceAlpha: options.faceAlpha,
    colorMode: options.colorMode,
    strainClip: options.strainClip,
  };
}
