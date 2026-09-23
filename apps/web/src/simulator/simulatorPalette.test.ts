import { describe, expect, it } from 'vitest';
import { parseCssRgb, resolveRenderSettings, resolveSimulatorPaint } from './simulatorPalette';
import { ORIEDITA_DASH_ONE_DOT } from '../lib/oristudioCpLineStyle';
import {
  applyCreaseStyle,
  DEFAULT_LIGHT_AZIMUTH,
  DEFAULT_LIGHT_ELEVATION,
  DEFAULT_MOUNTAIN_COLOR,
  DEFAULT_PAPER_STYLE,
  DEFAULT_VALLEY_COLOR,
  setPaperStyleField,
  type PaperStyle,
} from '../lib/paper/paperStyle';
import { lightVector } from '../lib/paper/paperStyleResolve';
import { DEFAULT_SIMULATOR_SETTINGS, type SimulatorSettings } from '../lib/simulatorSettings';

/**
 * Re-pinned when the palette became a wrapper over `resolvePaperStyle`: the
 * colours, weight and dash used to come from nullable simulator settings and
 * theme tokens; they now come from the app-wide paper style, which carries no
 * "follow the theme" value. What is the palette's own — the theme ground and
 * the framing — is what these pin; the style's own resolution is pinned in
 * `lib/paper/paperStyleResolve.test.ts`.
 */

/** A surface carrying theme tokens, as a mounted canvas would. */
function themed(tokens: Record<string, string> = {}): CSSStyleDeclaration {
  const element = document.createElement('div');
  for (const [name, value] of Object.entries(tokens)) {
    element.style.setProperty(name, value);
  }
  document.body.appendChild(element);
  return getComputedStyle(element);
}

function settingsWith(overrides: Partial<SimulatorSettings>): SimulatorSettings {
  return { ...DEFAULT_SIMULATOR_SETTINGS, ...overrides };
}

function styleWith(patch: Partial<PaperStyle>): PaperStyle {
  return { ...DEFAULT_PAPER_STYLE, ...patch };
}

/** A 0..1 render colour back to hex, for legible assertions. */
function hex(color: readonly [number, number, number]): string {
  const channel = (value: number) =>
    Math.round(value * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${channel(color[0])}${channel(color[1])}${channel(color[2])}`;
}

describe('resolving simulator colours', () => {
  it('draws the paper the style says, whatever the theme', () => {
    // No theme token reaches the paper any more: the style is self-contained.
    const settings = resolveRenderSettings(
      themed({ '--sim-paper-front': '#112233', '--sim-paper-back': '#445566' }),
      DEFAULT_SIMULATOR_SETTINGS,
      styleWith({ paper: { front: '#ff8800', back: '#00ff88' } })
    );
    expect(hex(settings.frontColor)).toBe('#ff8800');
    expect(hex(settings.backColor)).toBe('#00ff88');
  });

  it('defaults creases to the origami convention rather than a theme token', () => {
    // Mountain and valley have to stay high-contrast and recognisable in either
    // theme; a theme that tinted them would change what the drawing means.
    const settings = resolveRenderSettings(
      themed({ '--status-danger': '#00ff00', '--accent-primary': '#00ff00' }),
      DEFAULT_SIMULATOR_SETTINGS,
      DEFAULT_PAPER_STYLE
    );
    expect(hex(settings.mountainColor)).toBe(DEFAULT_MOUNTAIN_COLOR);
    expect(hex(settings.valleyColor)).toBe(DEFAULT_VALLEY_COLOR);
  });

  it('carries the pens through', () => {
    let style = setPaperStyleField(DEFAULT_PAPER_STYLE, 'mountainFolds', {
      ...DEFAULT_PAPER_STYLE.mountainFolds,
      color: '#aa0000',
      width: 3,
    });
    style = setPaperStyleField(style, 'edges', { ...style.edges, color: '#333333' });
    const settings = resolveRenderSettings(themed(), DEFAULT_SIMULATOR_SETTINGS, style);
    expect(hex(settings.mountainColor)).toBe('#aa0000');
    expect(hex(settings.borderColor)).toBe('#333333');
    expect(settings.creaseWidthPx).toBeGreaterThan(
      resolveRenderSettings(themed(), DEFAULT_SIMULATOR_SETTINGS, DEFAULT_PAPER_STYLE).creaseWidthPx
    );
  });

  it('paints an opaque backdrop by default', () => {
    // The Simulate workspace's panel fills its pane; anything showing through
    // there would be the app chrome behind it.
    expect(
      resolveRenderSettings(themed(), DEFAULT_SIMULATOR_SETTINGS, DEFAULT_PAPER_STYLE)
        .backgroundAlpha
    ).toBe(1);
  });

  it('clears to nothing for a transparent surface', () => {
    // An inline window sits on the crease pattern. Clearing to an opaque colour
    // is what made it read as a hole punched in the drawing.
    expect(
      resolveRenderSettings(themed(), DEFAULT_SIMULATOR_SETTINGS, DEFAULT_PAPER_STYLE, {
        transparentBackground: true,
      }).backgroundAlpha
    ).toBe(0);
  });

  it('takes the background from the theme ground either way', () => {
    // The one theme token left: the style has no background, and alpha alone
    // decides visibility. Dropping the colour would change what a translucent
    // surface blends toward if one is ever wanted.
    const styles = themed({ '--bg-canvas': '#010203' });
    const opaque = resolveRenderSettings(styles, DEFAULT_SIMULATOR_SETTINGS, DEFAULT_PAPER_STYLE);
    const clear = resolveRenderSettings(styles, DEFAULT_SIMULATOR_SETTINGS, DEFAULT_PAPER_STYLE, {
      transparentBackground: true,
    });
    expect(hex(opaque.background)).toBe('#010203');
    expect(clear.background).toEqual(opaque.background);
  });

  it('reads the framing from the simulator settings', () => {
    const settings = resolveRenderSettings(
      themed(),
      settingsWith({ renderMode: 'xray', colorMode: 'strain', showFaces: false, strainClip: 9 }),
      DEFAULT_PAPER_STYLE,
      { creaseWidthReferenceEdge: 240, creaseWidthShrinkExponent: 0.5 }
    );
    expect(settings.faceAlpha).toBeLessThan(1);
    expect(settings.colorMode).toBe('strain');
    expect(settings.showFaces).toBe(false);
    expect(settings.strainClip).toBe(9);
    expect(settings.creaseWidthReferenceEdge).toBe(240);
    expect(settings.creaseWidthShrinkExponent).toBe(0.5);
  });

  it('lights from the style, in the direction every renderer shared before', () => {
    // Re-pinned: `PAPER_LIGHT_DIRECTION` is gone — the canvas-2D path reads
    // `lightDir` off the settings like the other two — so the pin is against
    // the default style's angles, which were chosen to reproduce that vector.
    const lit = resolveRenderSettings(themed(), DEFAULT_SIMULATOR_SETTINGS, DEFAULT_PAPER_STYLE);
    expect(lit.lighting).toBe(true);
    const shared = lightVector(DEFAULT_LIGHT_AZIMUTH, DEFAULT_LIGHT_ELEVATION);
    for (let i = 0; i < 3; i += 1) {
      expect(lit.lightDir[i]).toBeCloseTo(shared[i]!, 6);
    }
    const turned = resolveRenderSettings(
      themed(),
      DEFAULT_SIMULATOR_SETTINGS,
      styleWith({ light: { enabled: true, azimuth: 90, elevation: 0 } })
    );
    expect(turned.lightDir[0]).toBeCloseTo(1, 6);
    const unlit = resolveRenderSettings(
      themed(),
      DEFAULT_SIMULATOR_SETTINGS,
      styleWith({ light: { ...DEFAULT_PAPER_STYLE.light, enabled: false } })
    );
    expect(unlit.lighting).toBe(false);
  });

  it('is the single source both render paths draw from', () => {
    // The regression this pins. There used to be two resolutions and they
    // disagreed: the canvas-2D path took mountains from --status-danger and
    // valleys from --accent-primary (teal) while the GPU and SVG paths used
    // #db1f24 and #1c5cd9. A fold profile forces the canvas-2D path even with
    // WebGL2 available, so that was what every segment simulation drew.
    const styles = themed({ '--status-danger': '#e06c75', '--accent-primary': '#5fb3a5' });
    const paint = resolveSimulatorPaint(styles, DEFAULT_SIMULATOR_SETTINGS, DEFAULT_PAPER_STYLE);
    expect(hex(paint.render.mountainColor)).toBe(DEFAULT_MOUNTAIN_COLOR);
    expect(hex(paint.render.valleyColor)).toBe(DEFAULT_VALLEY_COLOR);
    // And the canvas-2D-only inks are separate, not a second copy of these.
    expect(paint.chrome.highlight).toBeTruthy();
  });

  it('draws a crease where its own paper shows, since a simulation’s layers coincide', () => {
    // A simulation has no thickness, so depth cannot say which flat-folded
    // layer is on top and every buried layer's creases would show through.
    const render = resolveRenderSettings(themed(), DEFAULT_SIMULATOR_SETTINGS, DEFAULT_PAPER_STYLE);
    expect(render.creaseVisibility).toBe('own-face');
  });

  it('carries nothing a renderer does not read', () => {
    // Re-pinned: `showHiddenLines` used to ride here for the canvas-2D path
    // alone. A GPU-side no-op is gone rather than a third field the worker
    // ignores.
    const paint = resolveSimulatorPaint(themed(), DEFAULT_SIMULATOR_SETTINGS, DEFAULT_PAPER_STYLE);
    expect(Object.keys(paint).sort()).toEqual(['chrome', 'render']);
  });
});

describe('parsing a css colour', () => {
  it('reads six-digit hex, three-digit hex, and rgb()', () => {
    expect(parseCssRgb('#ff8000', [0, 0, 0])).toEqual([255, 128, 0]);
    expect(parseCssRgb('#f80', [0, 0, 0])).toEqual([255, 136, 0]);
    expect(parseCssRgb('rgb(1 2 3)', [0, 0, 0])).toEqual([1, 2, 3]);
  });

  it('falls back rather than producing NaN channels', () => {
    expect(parseCssRgb('', [9, 9, 9])).toEqual([9, 9, 9]);
    expect(parseCssRgb('not-a-colour', [9, 9, 9])).toEqual([9, 9, 9]);
  });
});

describe('the crease-style switch through the palette', () => {
  it('leaves colour styles undashed and per-kind coloured', () => {
    const settings = resolveRenderSettings(
      themed(),
      DEFAULT_SIMULATOR_SETTINGS,
      applyCreaseStyle(DEFAULT_PAPER_STYLE, 'color')
    );
    expect(settings.creaseDash).toBeUndefined();
    expect(hex(settings.mountainColor)).toBe(DEFAULT_MOUNTAIN_COLOR);
    expect(hex(settings.valleyColor)).toBe(DEFAULT_VALLEY_COLOR);
  });

  it('paints every crease in the edge ink under a mono style', () => {
    const edged = setPaperStyleField(DEFAULT_PAPER_STYLE, 'edges', {
      ...DEFAULT_PAPER_STYLE.edges,
      color: '#223344',
    });
    for (const mode of ['mono', 'mono-dashed'] as const) {
      const settings = resolveRenderSettings(
        themed(),
        DEFAULT_SIMULATOR_SETTINGS,
        applyCreaseStyle(edged, mode)
      );
      expect(hex(settings.mountainColor)).toBe('#223344');
      expect(hex(settings.valleyColor)).toBe('#223344');
      expect(hex(settings.borderColor)).toBe('#223344');
    }
  });

  it('carries Oriedita’s dash onto the settings every renderer reads, in device px', () => {
    // At the default 1.1 px pen on a standard display the runs are Oriedita's own.
    const settings = resolveRenderSettings(
      themed(),
      DEFAULT_SIMULATOR_SETTINGS,
      applyCreaseStyle(DEFAULT_PAPER_STYLE, 'mono-dashed')
    );
    const runs = settings.creaseDash?.mountain ?? [];
    expect(runs).toHaveLength(ORIEDITA_DASH_ONE_DOT.length);
    runs.forEach((run, i) => expect(run).toBeCloseTo(ORIEDITA_DASH_ONE_DOT[i]!, 6));
    // A paper boundary is not a fold.
    expect(settings.creaseDash?.border).toBeNull();
  });
});
