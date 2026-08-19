import type { SimulatorOptions } from '@treemaker/origami-simulator';

/**
 * User-facing simulator settings: how the fold is drawn, what the paper is made
 * of, and how hard the solver works.
 *
 * Pure data plus clamps, with no React or store dependency, so the options pane,
 * the simulator panel, and the store slice all agree on ranges and defaults.
 * The material and solver values map straight onto the engine's
 * {@link SimulatorOptions}, which both backends apply live.
 */

export type SimulatorRenderMode = 'paper' | 'xray';

/**
 * `paper` draws the two-tone sheet; `strain` colours each face by how far its
 * edges are stretched, which is where a crease pattern is not physically
 * foldable.
 */
export type SimulatorColorMode = 'paper' | 'strain';

/**
 * Page background of an exported view.
 *
 * Not part of the on-screen render: the panel's backdrop is the app's canvas
 * colour and has to stay that way, but a file dropped into a document should not
 * carry the app's dark chrome with it. `transparent` composites into anything,
 * which is why it is the default; the crease export flow reached the same
 * conclusion from the other direction and defaults to light.
 */
export type SimulatorExportBackground = 'transparent' | 'white' | 'theme';

/**
 * A colour override, or `null` to follow the theme.
 *
 * Nullable rather than a concrete default on purpose. Paper is a theme token
 * (`--sim-paper-front` / `--sim-paper-back`), so baking a hex into the defaults
 * would freeze it the first time settings were persisted and switching theme
 * would stop moving it. `null` also gives "reset" something real to mean.
 */
export type SimulatorColorOverride = string | null;

/**
 * How mountains and valleys are drawn.
 *
 * Three, not Oriedita's five. `black-one-dot` versus `black-two-dot` earns its
 * keep on a dense flat crease pattern and does not here, and `color-and-shape`
 * collapses into `color` once the geometry is already showing the fold direction.
 *
 * `mono-dashed` exists because the simulator spends a lot of time near 0% fold,
 * where the model is nearly flat and the dashes *are* the crease-pattern
 * convention the user just came from. Its usefulness decays as the fold closes;
 * it does not vanish. Hidden lines stay a separate axis for the same reason —
 * on an already-folded form a dashed line usually means "behind a layer", so the
 * two must not compete for the same signal.
 */
export type SimulatorCreaseStyle = 'color' | 'mono' | 'mono-dashed';

export const SIMULATOR_CREASE_STYLES: readonly SimulatorCreaseStyle[] = [
  'color',
  'mono',
  'mono-dashed',
];

export interface SimulatorSettings {
  renderMode: SimulatorRenderMode;
  colorMode: SimulatorColorMode;
  showFaces: boolean;
  showEdges: boolean;
  showHiddenLines: boolean;
  lighting: boolean;
  /** Paper front/back, or null for the theme's `--sim-paper-*` tokens. */
  paperFront: SimulatorColorOverride;
  paperBack: SimulatorColorOverride;
  /**
   * Crease inks, or null for the fixed origami-convention defaults. Those
   * defaults are deliberately not theme tokens — mountain and valley have to stay
   * high-contrast and recognisable in both themes.
   */
  mountainColor: SimulatorColorOverride;
  valleyColor: SimulatorColorOverride;
  borderColor: SimulatorColorOverride;
  /** Crease line weight in device pixels. */
  creaseWidth: number;
  creaseStyle: SimulatorCreaseStyle;
  exportBackground: SimulatorExportBackground;
  /** Resistance to stretching along an edge. The stiffest element, so it sets the timestep. */
  axialStiffness: number;
  /** Resistance to folding a mountain/valley crease away from its target angle. */
  creaseStiffness: number;
  /** Resistance to folding a facet (triangulation) crease, which should stay flat. */
  panelStiffness: number;
  /** Resistance to shearing a triangle's interior angles. */
  faceStiffness: number;
  /** Velocity damping. Higher settles faster and tolerates stiffer material. */
  damping: number;
  /**
   * Fraction of the stable timestep to integrate with. The bound is derived from
   * axial stiffness alone, so dense patterns with stiff creases need headroom;
   * see `bench:gpu-stability`.
   */
  timeStepScale: number;
  /** Fold percent per second while playing. */
  foldPlayPercentPerSecond: number;
  /**
   * Percent axial strain drawn fully red in `strain` colour mode. Upstream's
   * `strainClip`.
   */
  strainClip: number;
}

export type SimulatorSettingKey = keyof SimulatorSettings;

/**
 * Defaults. The material values are upstream Origami Simulator's, and the
 * timestep/play defaults match `simulatorRunConfig`'s whole-model profile.
 */
export const DEFAULT_SIMULATOR_SETTINGS: SimulatorSettings = {
  renderMode: 'paper',
  colorMode: 'paper',
  showFaces: true,
  showEdges: true,
  showHiddenLines: false,
  lighting: true,
  paperFront: null,
  paperBack: null,
  mountainColor: null,
  valleyColor: null,
  borderColor: null,
  creaseWidth: 1.1,
  creaseStyle: 'color',
  exportBackground: 'transparent',
  axialStiffness: 20,
  creaseStiffness: 0.7,
  panelStiffness: 0.7,
  faceStiffness: 0.2,
  damping: 0.45,
  timeStepScale: 0.35,
  foldPlayPercentPerSecond: 28,
  strainClip: 5,
};

interface NumericRange {
  min: number;
  max: number;
  step: number;
}

/** Slider ranges for the numeric settings, keyed the same as the settings. */
export const SIMULATOR_SETTING_RANGES = {
  // Device pixels. The floor is 0.5 rather than 0 because a zero-width crease is
  // "hidden", which `showEdges` already expresses.
  creaseWidth: { min: 0.5, max: 6, step: 0.1 },
  axialStiffness: { min: 1, max: 100, step: 1 },
  creaseStiffness: { min: 0, max: 5, step: 0.05 },
  panelStiffness: { min: 0, max: 5, step: 0.05 },
  faceStiffness: { min: 0, max: 5, step: 0.05 },
  damping: { min: 0, max: 1, step: 0.01 },
  // Never 0: a zero timestep would freeze the solve entirely.
  timeStepScale: { min: 0.05, max: 1, step: 0.05 },
  foldPlayPercentPerSecond: { min: 2, max: 100, step: 1 },
  strainClip: { min: 0.5, max: 20, step: 0.5 },
} as const satisfies Record<string, NumericRange>;

export type SimulatorNumericSettingKey = keyof typeof SIMULATOR_SETTING_RANGES;

/** The numeric keys that describe the paper itself, for a "reset material" action. */
export const SIMULATOR_MATERIAL_KEYS = [
  'axialStiffness',
  'creaseStiffness',
  'panelStiffness',
  'faceStiffness',
  'damping',
] as const satisfies readonly SimulatorNumericSettingKey[];

/** The keys that describe how the fold is drawn, for a "reset style" action. */
export const SIMULATOR_STYLE_KEYS = [
  'paperFront',
  'paperBack',
  'mountainColor',
  'valleyColor',
  'borderColor',
  'creaseWidth',
  'creaseStyle',
] as const satisfies readonly SimulatorSettingKey[];

/** The nullable colour overrides, so one loop can validate and reset them all. */
export const SIMULATOR_COLOR_KEYS = [
  'paperFront',
  'paperBack',
  'mountainColor',
  'valleyColor',
  'borderColor',
] as const satisfies readonly SimulatorSettingKey[];

export type SimulatorColorSettingKey = (typeof SIMULATOR_COLOR_KEYS)[number];

function isColorSetting(key: SimulatorSettingKey): key is SimulatorColorSettingKey {
  return (SIMULATOR_COLOR_KEYS as readonly SimulatorSettingKey[]).includes(key);
}

/**
 * Six-digit hex, the one form every consumer here can rely on: `input
 * type="color"` only ever produces it, `parseCssRgb` reads it, and the SVG
 * exporter writes it. Anything else in persisted settings is treated as absent
 * rather than passed through to a renderer.
 */
const HEX_COLOR = /^#[0-9a-f]{6}$/i;

export function isSimulatorColor(value: unknown): value is string {
  return typeof value === 'string' && HEX_COLOR.test(value);
}

export function isSimulatorNumericSetting(
  key: SimulatorSettingKey,
): key is SimulatorNumericSettingKey {
  return key in SIMULATOR_SETTING_RANGES;
}

/**
 * Hold a numeric setting inside its range, rejecting non-finite input (an empty
 * or half-typed number field) by falling back to the default.
 */
export function clampSimulatorSetting(key: SimulatorNumericSettingKey, value: number): number {
  const range = SIMULATOR_SETTING_RANGES[key];
  if (!Number.isFinite(value)) return DEFAULT_SIMULATOR_SETTINGS[key];
  return Math.min(range.max, Math.max(range.min, value));
}

/** Normalize an untrusted (persisted) settings object into a complete, in-range one. */
export function normalizeSimulatorSettings(source: unknown): SimulatorSettings {
  if (!source || typeof source !== 'object') return DEFAULT_SIMULATOR_SETTINGS;
  const raw = source as Partial<Record<SimulatorSettingKey, unknown>>;
  const next: SimulatorSettings = { ...DEFAULT_SIMULATOR_SETTINGS };
  for (const key of Object.keys(DEFAULT_SIMULATOR_SETTINGS) as SimulatorSettingKey[]) {
    const value = raw[key];
    if (value === undefined) continue;
    if (isSimulatorNumericSetting(key)) {
      if (typeof value === 'number') next[key] = clampSimulatorSetting(key, value);
      continue;
    }
    if (key === 'renderMode') {
      if (value === 'paper' || value === 'xray') next.renderMode = value;
      continue;
    }
    if (key === 'colorMode') {
      if (value === 'paper' || value === 'strain') next.colorMode = value;
      continue;
    }
    if (key === 'creaseStyle') {
      if ((SIMULATOR_CREASE_STYLES as readonly unknown[]).includes(value)) {
        next.creaseStyle = value as SimulatorCreaseStyle;
      }
      continue;
    }
    if (key === 'exportBackground') {
      if (value === 'transparent' || value === 'white' || value === 'theme') {
        next.exportBackground = value;
      }
      continue;
    }
    if (isColorSetting(key)) {
      // Null is meaningful (follow the theme), and anything that is neither null
      // nor a hex colour is dropped rather than handed to a renderer.
      if (value === null) next[key] = null;
      else if (isSimulatorColor(value)) next[key] = value;
      continue;
    }
    if (typeof value === 'boolean') next[key] = value;
  }
  return next;
}

/**
 * The engine-facing subset. Everything here is accepted by both solver backends
 * and applied live -- each recomputes the timestep on material change -- so the
 * pane can edit it without reloading the model.
 */
export function simulatorMaterialOptions(settings: SimulatorSettings): Partial<SimulatorOptions> {
  return {
    axialStiffness: settings.axialStiffness,
    creaseStiffness: settings.creaseStiffness,
    panelStiffness: settings.panelStiffness,
    faceStiffness: settings.faceStiffness,
    damping: settings.damping,
    timeStepScale: settings.timeStepScale,
    // NOTE: integrationType is deliberately not sent. The GPU implements Verlet
    // and it matches the CPU oracle numerically, but it looks wrong in the app,
    // so the choice is not exposed until that is understood. Omitting it leaves
    // the engine on its Euler default.
  };
}
