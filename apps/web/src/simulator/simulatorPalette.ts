import type { CreaseDash, RenderSettings } from '@treemaker/origami-simulator';
import {
  ORIEDITA_DASH_ONE_DOT,
  ORIEDITA_DASH_VALLEY,
} from '../lib/oristudioCpLineStyle';
import type {
  SimulatorColorSettingKey,
  SimulatorCreaseStyle,
  SimulatorSettings,
} from '../lib/simulatorSettings';

/**
 * The one place a simulator colour is decided.
 *
 * There used to be two: `toRenderSettings` resolved a palette for the GPU and
 * SVG renderers, and `readSimulatorPalette` resolved a second one for the
 * canvas-2D renderer — and they disagreed. Mountains were `#db1f24` on one path
 * and `--status-danger` on the other; valleys were blue on one and
 * `--accent-primary` (teal) on the other. That was not a dormant fallback
 * either: a fold profile forces the canvas-2D path even on a machine with
 * WebGL2, so every segment and sequence-step simulation drew its valleys the
 * wrong colour.
 *
 * `RenderSettings` is the struct all three renderers consume, so it is the
 * contract, and this module is the only thing allowed to build one. Anything a
 * style option cannot express through it would diverge silently between the
 * screen and the export.
 */

/** How the surface is framed, as opposed to how the paper is drawn. */
export interface SimulatorSurfaceOptions {
  /** Leave the frame unpainted so whatever is behind the canvas shows through. */
  transparentBackground?: boolean;
  /**
   * Frame edge, in device px, the crease width is calibrated for. Set by a
   * surface that is an object on someone else's canvas rather than a viewport,
   * so its linework shrinks with it — see `RenderSettings.creaseWidthReferenceEdge`.
   */
  creaseWidthReferenceEdge?: number;
  /** Companion to the reference edge; see `RenderSettings.creaseWidthShrinkExponent`. */
  creaseWidthShrinkExponent?: number;
}

/**
 * Fixed origami-convention crease inks.
 *
 * Deliberately not theme tokens: mountain and valley have to stay high-contrast
 * and recognisable in either theme, and a theme that tinted them would be
 * changing what the drawing *means* rather than how it looks. Users can still
 * override them per setting.
 */
export const DEFAULT_MOUNTAIN_COLOR = '#db1f24';
export const DEFAULT_VALLEY_COLOR = '#1c5cd9';

/** Fallbacks for the theme tokens, for a surface with no computed style yet. */
const FALLBACK = {
  paperFront: '#ffff32',
  paperBack: '#f2f0e7',
  border: '#e8edf0',
  canvas: '#0c0f12',
  flat: '#aeb9bf',
  highlight: '#f0c674',
} as const;

/**
 * Colours only the canvas-2D renderer draws with, so they are not on
 * `RenderSettings`.
 *
 * The GPU and SVG renderers have no sequence highlights and no facet ink; giving
 * them fields they ignore would make the contract lie about what a renderer
 * honours.
 */
export interface SimulatorChrome {
  /** Sequence-step emphasis. */
  highlight: string;
  highlightFaceRgb: Rgb;
  /** Facet and unassigned edges, which the GPU renderer skips entirely. */
  flat: string;
  /** The surface fill behind the model. */
  canvas: string;
}

export type Rgb = [number, number, number];

/** Light direction shared by every renderer, so shading matches everywhere. */
export const PAPER_LIGHT_DIRECTION: Rgb = normalize([-0.45, 0.58, 0.68]);

function normalize([x, y, z]: Rgb): Rgb {
  const length = Math.hypot(x, y, z);
  if (length < 0.0001) return [0, 0, 1];
  return [x / length, y / length, z / length];
}

function cssVar(styles: CSSStyleDeclaration | null, name: string, fallback: string): string {
  const value = styles?.getPropertyValue(name).trim();
  return value ? value : fallback;
}

/** Parse `#rgb`, `#rrggbb`, or any `rgb()`-ish form into 0..255 channels. */
export function parseCssRgb(value: string, fallback: Rgb): Rgb {
  const hex = value.trim().replace('#', '');
  if (hex.length === 6) {
    const channels: Rgb = [
      Number.parseInt(hex.slice(0, 2), 16),
      Number.parseInt(hex.slice(2, 4), 16),
      Number.parseInt(hex.slice(4, 6), 16),
    ];
    if (channels.every(Number.isFinite)) return channels;
  }
  if (hex.length === 3) {
    const channels: Rgb = [
      Number.parseInt(hex[0]! + hex[0], 16),
      Number.parseInt(hex[1]! + hex[1], 16),
      Number.parseInt(hex[2]! + hex[2], 16),
    ];
    if (channels.every(Number.isFinite)) return channels;
  }
  const match = value.match(/-?\d+(\.\d+)?/g);
  if (match && match.length >= 3) {
    return [Number(match[0]), Number(match[1]), Number(match[2])];
  }
  return fallback;
}

function unit(rgb: Rgb): Rgb {
  return [rgb[0] / 255, rgb[1] / 255, rgb[2] / 255];
}

/**
 * Resolve a colour: the user's override if they set one, otherwise the theme
 * token (or a fixed convention colour, for the crease inks).
 */
function resolve(
  override: string | null,
  styles: CSSStyleDeclaration | null,
  token: string | null,
  fallback: string
): Rgb {
  if (override) return parseCssRgb(override, parseCssRgb(fallback, [0, 0, 0]));
  const themed = token ? cssVar(styles, token, fallback) : fallback;
  return parseCssRgb(themed, parseCssRgb(fallback, [0, 0, 0]));
}

/**
 * Flatten a crease style into concrete dash patterns.
 *
 * This is the whole reason no renderer sees `SimulatorCreaseStyle`: three
 * renderers each interpreting a style name would be three chances to disagree,
 * where three renderers reading a colour and a run-length array cannot.
 *
 * The patterns are Oriedita's own, in device pixels and unscaled by zoom, so a
 * crease dashes the same here as in the crease pattern it came from.
 */
export function creaseDashFor(style: SimulatorCreaseStyle): CreaseDash | undefined {
  if (style !== 'mono-dashed') return undefined;
  return {
    // Paper boundaries are not folds, so they stay solid under every style.
    border: null,
    mountain: ORIEDITA_DASH_ONE_DOT,
    valley: ORIEDITA_DASH_VALLEY,
  };
}

/** True when the active style dashes anything — see the hidden-line note below. */
export function creaseStyleDashes(style: SimulatorCreaseStyle): boolean {
  return creaseDashFor(style) !== undefined;
}

/**
 * Build the render settings every renderer draws from.
 *
 * `styles` is the computed style of the surface the simulation is mounted in,
 * which is where the theme tokens come from; pass null when there is no element
 * (a test, or a headless render) and the fallbacks apply.
 */
export function resolveRenderSettings(
  styles: CSSStyleDeclaration | null,
  settings: SimulatorSettings,
  surface: SimulatorSurfaceOptions = {}
): RenderSettings {
  const dpr = typeof window === 'undefined' ? 1 : Math.max(1, window.devicePixelRatio || 1);
  const edge = resolve(settings.borderColor, styles, '--text-primary', FALLBACK.border);
  const mono = settings.creaseStyle !== 'color';
  return {
    frontColor: unit(resolve(settings.paperFront, styles, '--sim-paper-front', FALLBACK.paperFront)),
    backColor: unit(resolve(settings.paperBack, styles, '--sim-paper-back', FALLBACK.paperBack)),
    // A mono style is one ink for every crease, so it overrides the per-kind
    // colours rather than sitting alongside them — that is what "mono" means.
    // The ink is the edge colour, which is theme-derived, so it stays legible on
    // dark paper where a literal black would not.
    mountainColor: unit(
      mono ? edge : resolve(settings.mountainColor, styles, null, DEFAULT_MOUNTAIN_COLOR)
    ),
    valleyColor: unit(
      mono ? edge : resolve(settings.valleyColor, styles, null, DEFAULT_VALLEY_COLOR)
    ),
    borderColor: unit(edge),
    creaseDash: creaseDashFor(settings.creaseStyle),
    background: unit(resolve(null, styles, '--bg-canvas', FALLBACK.canvas)),
    backgroundAlpha: surface.transparentBackground ? 0 : 1,
    lightDir: PAPER_LIGHT_DIRECTION,
    showFaces: settings.showFaces,
    showEdges: settings.showEdges,
    lighting: settings.lighting,
    // Scaled to device pixels so a crease reads at the same on-screen weight on
    // a hi-dpi display as on a standard one.
    creaseWidthPx: Math.max(0.5, settings.creaseWidth * dpr),
    creaseWidthReferenceEdge: surface.creaseWidthReferenceEdge,
    creaseWidthShrinkExponent: surface.creaseWidthShrinkExponent,
    faceAlpha: settings.renderMode === 'xray' ? 0.48 : 1,
    colorMode: settings.colorMode,
    strainClip: settings.strainClip,
  };
}

/**
 * Everything a renderer needs to draw a frame, resolved once per settings or
 * theme change.
 *
 * The viewport builds one of these and uses it twice: `render` is what goes to
 * the worker (and so to the GPU renderer and the SVG exporter), and the whole
 * bundle is what the canvas-2D renderer draws from. That is what makes "the
 * export matches the screen" true by construction rather than by care.
 */
export interface SimulatorPaint {
  render: RenderSettings;
  chrome: SimulatorChrome;
  /**
   * Draw occluded creases faintly. Canvas-2D only: the GPU renderer has no
   * hidden-line mode, so it is not on {@link RenderSettings} — a field there that
   * two of three renderers ignored would make the contract lie.
   */
  showHiddenLines: boolean;
}

export function resolveSimulatorPaint(
  styles: CSSStyleDeclaration | null,
  settings: SimulatorSettings,
  surface: SimulatorSurfaceOptions = {}
): SimulatorPaint {
  return {
    render: resolveRenderSettings(styles, settings, surface),
    chrome: resolveSimulatorChrome(styles),
    showHiddenLines: settings.showHiddenLines,
  };
}

/** The canvas-2D-only inks. See {@link SimulatorChrome}. */
export function resolveSimulatorChrome(styles: CSSStyleDeclaration | null): SimulatorChrome {
  const highlight = cssVar(styles, '--status-warning', FALLBACK.highlight);
  return {
    highlight,
    highlightFaceRgb: [240, 198, 116],
    flat: cssVar(styles, '--text-secondary', FALLBACK.flat),
    canvas: cssVar(styles, '--bg-canvas', FALLBACK.canvas),
  };
}

/**
 * The colour each override falls back to, as `#rrggbb`.
 *
 * The options pane needs these because a swatch has to show *something* while
 * the setting is unset, and showing the theme's actual paper is the only honest
 * answer — a hardcoded swatch would tell the user a colour they are not looking
 * at. Recompute on a theme change; the values move with it.
 */
export function simulatorStyleDefaults(
  styles: CSSStyleDeclaration | null
): Record<SimulatorColorSettingKey, string> {
  const hex = (rgb: Rgb) =>
    `#${rgb
      .map((channel) =>
        Math.round(Math.min(255, Math.max(0, channel)))
          .toString(16)
          .padStart(2, '0')
      )
      .join('')}`;
  return {
    paperFront: hex(resolve(null, styles, '--sim-paper-front', FALLBACK.paperFront)),
    paperBack: hex(resolve(null, styles, '--sim-paper-back', FALLBACK.paperBack)),
    mountainColor: DEFAULT_MOUNTAIN_COLOR,
    valleyColor: DEFAULT_VALLEY_COLOR,
    borderColor: hex(resolve(null, styles, '--text-primary', FALLBACK.border)),
  };
}

/** A 0..1 render colour as a CSS string, for the canvas-2D path. */
export function renderColorToCss(color: readonly [number, number, number], alpha = 1): string {
  const channel = (value: number) => Math.round(Math.min(1, Math.max(0, value)) * 255);
  const [r, g, b] = [channel(color[0]), channel(color[1]), channel(color[2])];
  return alpha >= 1 ? `rgb(${r} ${g} ${b})` : `rgb(${r} ${g} ${b} / ${alpha})`;
}

/** A 0..1 render colour as 0..255 channels, for the canvas-2D rasterizer. */
export function renderColorToRgb(color: readonly [number, number, number]): Rgb {
  const channel = (value: number) => Math.round(Math.min(1, Math.max(0, value)) * 255);
  return [channel(color[0]), channel(color[1]), channel(color[2])];
}
