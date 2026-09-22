/**
 * From a {@link PaperStyle} to the `RenderSettings` the simulator's GPU, SVG
 * and canvas-2D renderers draw from — the one place a pt becomes a device px
 * and a pen's dash becomes device-px runs.
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

const SIMULATION_FIELDS: PaperStyleField[] = [
  'paper.front',
  'paper.back',
  'edges',
  'mountainFolds',
  'valleyFolds',
  'light',
];

/**
 * Phase 1 policies. `auxCreases.*` and `erode` join every surface when the
 * renderers can draw them; `arrows` stays References-only.
 */
export const PAPER_STYLE_POLICIES: Record<PaperSurface, SurfaceStylePolicy> = {
  simulator: { surface: 'simulator', applies: SIMULATION_FIELDS },
  'inline-simulation': { surface: 'inline-simulation', applies: SIMULATION_FIELDS },
  'folded-3d': { surface: 'folded-3d', applies: ['paper.front', 'paper.back', 'edges', 'light'] },
  'folded-flat': { surface: 'folded-flat', applies: ['paper.front', 'paper.back', 'edges'] },
  // The paper too (D13): a step's sheet is filled with the style's paper, or a
  // black edge pen would vanish on a dark theme's ground.
  references: {
    surface: 'references',
    applies: [
      'paper.front',
      'paper.back',
      'edges',
      'mountainFolds',
      'valleyFolds',
      'auxCreases.pen',
      'arrows',
    ],
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
 * `RenderSettings` carries one crease width, so the mountain pen's width is
 * the one that goes there where the policy applies fold pens, and the edge
 * pen's where it does not (the folded figures, whose creases are all drawn in
 * the line colour). A surface whose policy leaves out the fold pens draws them
 * with the edge pen; one whose policy leaves out `light` draws unlit. The
 * light direction is data from the style either way, so a lit surface and an
 * unlit one agree on where the light would be.
 */
export function resolvePaperStyle(
  style: PaperStyle,
  policy: SurfaceStylePolicy,
  options: ResolvePaperStyleOptions
): RenderSettings {
  const seen = applyPaperStylePolicy(style, policy);
  const { dpr } = options;
  const edges = seen.edges;
  const foldPens = policyApplies(policy, 'mountainFolds');
  const mountain = foldPens ? seen.mountainFolds : edges;
  const valley = policyApplies(policy, 'valleyFolds') ? seen.valleyFolds : edges;
  const dash: CreaseDash = {
    border: penDashDevicePx(edges, dpr),
    mountain: penDashDevicePx(mountain, dpr),
    valley: penDashDevicePx(valley, dpr),
  };
  const anyDash = dash.border !== null || dash.mountain !== null || dash.valley !== null;
  return {
    frontColor: hexToUnitRgb(seen.paper.front),
    backColor: hexToUnitRgb(seen.paper.back),
    mountainColor: hexToUnitRgb(mountain.color),
    valleyColor: hexToUnitRgb(valley.color),
    borderColor: hexToUnitRgb(edges.color),
    creaseDash: anyDash ? dash : undefined,
    background: options.background,
    backgroundAlpha: options.backgroundAlpha,
    lightDir: lightVector(seen.light.azimuth, seen.light.elevation),
    showFaces: options.showFaces ?? true,
    showEdges: options.showEdges ?? true,
    lighting: policyApplies(policy, 'light') && seen.light.enabled,
    // The floor keeps a hairline pen from vanishing on a standard display.
    creaseWidthPx: Math.max(0.5, ptToDevicePx(foldPens ? mountain.width : edges.width, dpr)),
    creaseWidthReferenceEdge: options.creaseWidthReferenceEdge,
    creaseWidthShrinkExponent: options.creaseWidthShrinkExponent,
    faceAlpha: options.faceAlpha,
    colorMode: options.colorMode,
    strainClip: options.strainClip,
  };
}
