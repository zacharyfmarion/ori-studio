import type { RenderSettings } from '@treemaker/origami-simulator';
import type { PaperStyle } from '../lib/paper/paperStyle';
import { PAPER_STYLE_POLICIES, resolvePaperStyle } from '../lib/paper/paperStyleResolve';
import type { SimulatorSettings } from '../lib/simulatorSettings';

/**
 * The one place the simulator's frame is decided.
 *
 * There used to be two resolvers of a simulator palette — one for the GPU
 * renderer, one for the canvas-2D renderer — and they disagreed, which was not
 * a dormant fallback: a fold profile forces the canvas-2D path even on a
 * machine with WebGL2. `RenderSettings` is the struct both on-screen renderers
 * consume, so it is the contract, and it is built in one place. The vector
 * export does not read it: the worker builds a scene (`meshToPaperScene`) and
 * paints it from the `PaperStyle` and `PaperPage` it is handed
 * (`paperSceneToSvg`), taking only `showFaces` / `showEdges` from here.
 *
 * That place is now `resolvePaperStyle` (`lib/paper/paperStyleResolve.ts`),
 * which turns the app-wide {@link PaperStyle} into device px once for every
 * surface. This module is the simulator's thin wrapper over it: it reads the
 * one thing the style does not carry — the theme ground behind the paper — and
 * the simulator's framing settings, and delegates the rest.
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

/** Fallbacks for the theme tokens, for a surface with no computed style yet. */
const FALLBACK = {
  canvas: '#0c0f12',
  flat: '#aeb9bf',
  highlight: '#f0c674',
} as const;

/**
 * Colours only the canvas-2D renderer draws with, so they are not on
 * `RenderSettings`.
 *
 * The GPU renderer has no sequence highlights and no facet ink; giving it
 * fields it ignores would make the contract lie about what a renderer honours.
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

/** The theme's canvas colour, which is what shows behind the paper. */
function themeGround(styles: CSSStyleDeclaration | null): Rgb {
  return parseCssRgb(
    cssVar(styles, '--bg-canvas', FALLBACK.canvas),
    parseCssRgb(FALLBACK.canvas, [0, 0, 0])
  );
}

/**
 * Build the render settings every renderer draws from.
 *
 * `styles` is the computed style of the surface the simulation is mounted in,
 * which is where the theme ground comes from; pass null when there is no
 * element (a test, or a headless render) and the fallback applies. `style` is
 * the paper style the surface draws with — the app's display style, or an
 * object's effective style once overrides reach the windows.
 */
export function resolveRenderSettings(
  styles: CSSStyleDeclaration | null,
  settings: SimulatorSettings,
  style: PaperStyle,
  surface: SimulatorSurfaceOptions = {}
): RenderSettings {
  const dpr = typeof window === 'undefined' ? 1 : Math.max(1, window.devicePixelRatio || 1);
  return resolvePaperStyle(style, PAPER_STYLE_POLICIES.simulator, {
    dpr,
    background: unit(themeGround(styles)),
    backgroundAlpha: surface.transparentBackground ? 0 : 1,
    faceAlpha: settings.renderMode === 'xray' ? 0.48 : 1,
    colorMode: settings.colorMode,
    strainClip: settings.strainClip,
    showFaces: settings.showFaces,
    showEdges: settings.showEdges,
    creaseWidthReferenceEdge: surface.creaseWidthReferenceEdge,
    creaseWidthShrinkExponent: surface.creaseWidthShrinkExponent,
  });
}

/**
 * Everything a renderer needs to draw a frame, resolved once per settings or
 * theme change.
 *
 * The viewport builds one of these and uses it twice: `render` is what goes to
 * the worker (and so to the GPU renderer), and the whole bundle is what the
 * canvas-2D renderer draws from. The vector export takes its look from the
 * same `PaperStyle` these settings were resolved from, through
 * `surfacePaperStyle`, which is what keeps the file's pens the screen's.
 */
export interface SimulatorPaint {
  render: RenderSettings;
  chrome: SimulatorChrome;
}

export function resolveSimulatorPaint(
  styles: CSSStyleDeclaration | null,
  settings: SimulatorSettings,
  style: PaperStyle,
  surface: SimulatorSurfaceOptions = {}
): SimulatorPaint {
  return {
    render: resolveRenderSettings(styles, settings, style, surface),
    chrome: resolveSimulatorChrome(styles),
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
