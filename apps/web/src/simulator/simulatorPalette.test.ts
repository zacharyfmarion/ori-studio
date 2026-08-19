import { describe, expect, it } from 'vitest';
import {
  creaseDashFor,
  creaseStyleDashes,
  DEFAULT_MOUNTAIN_COLOR,
  DEFAULT_VALLEY_COLOR,
  parseCssRgb,
  resolveRenderSettings,
  resolveSimulatorPaint,
} from './simulatorPalette';
import { ORIEDITA_DASH_ONE_DOT, ORIEDITA_DASH_VALLEY } from '../lib/oristudioCpLineStyle';
import { DEFAULT_SIMULATOR_SETTINGS, type SimulatorSettings } from '../lib/simulatorSettings';

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

/** A 0..1 render colour back to hex, for legible assertions. */
function hex(color: readonly [number, number, number]): string {
  const channel = (value: number) =>
    Math.round(value * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${channel(color[0])}${channel(color[1])}${channel(color[2])}`;
}

describe('resolving simulator colours', () => {
  it('follows the theme when nothing is overridden', () => {
    const settings = resolveRenderSettings(
      themed({ '--sim-paper-front': '#112233', '--sim-paper-back': '#445566' }),
      DEFAULT_SIMULATOR_SETTINGS,
    );
    expect(hex(settings.frontColor)).toBe('#112233');
    expect(hex(settings.backColor)).toBe('#445566');
  });

  it('lets an override win over the theme', () => {
    const styles = themed({ '--sim-paper-front': '#112233' });
    const settings = resolveRenderSettings(styles, settingsWith({ paperFront: '#ff8800' }));
    expect(hex(settings.frontColor)).toBe('#ff8800');
  });

  it('keeps following the theme after it changes, while unset', () => {
    // The reason the overrides are nullable: a concrete default would freeze the
    // paper the first time settings were persisted, and switching theme would
    // stop moving it.
    const dark = resolveRenderSettings(
      themed({ '--sim-paper-front': '#101010' }),
      DEFAULT_SIMULATOR_SETTINGS,
    );
    const light = resolveRenderSettings(
      themed({ '--sim-paper-front': '#f0f0f0' }),
      DEFAULT_SIMULATOR_SETTINGS,
    );
    expect(hex(dark.frontColor)).not.toBe(hex(light.frontColor));
  });

  it('defaults creases to the origami convention rather than a theme token', () => {
    // Mountain and valley have to stay high-contrast and recognisable in either
    // theme; a theme that tinted them would change what the drawing means.
    const settings = resolveRenderSettings(
      themed({ '--status-danger': '#00ff00', '--accent-primary': '#00ff00' }),
      DEFAULT_SIMULATOR_SETTINGS,
    );
    expect(hex(settings.mountainColor)).toBe(DEFAULT_MOUNTAIN_COLOR);
    expect(hex(settings.valleyColor)).toBe(DEFAULT_VALLEY_COLOR);
  });

  it('lets crease colours be overridden anyway', () => {
    const settings = resolveRenderSettings(
      themed(),
      settingsWith({ mountainColor: '#aa0000', valleyColor: '#0000aa', borderColor: '#333333' }),
    );
    expect(hex(settings.mountainColor)).toBe('#aa0000');
    expect(hex(settings.valleyColor)).toBe('#0000aa');
    expect(hex(settings.borderColor)).toBe('#333333');
  });

  it('carries the crease weight through to device pixels', () => {
    const thin = resolveRenderSettings(themed(), settingsWith({ creaseWidth: 1 }));
    const thick = resolveRenderSettings(themed(), settingsWith({ creaseWidth: 4 }));
    expect(thick.creaseWidthPx).toBeGreaterThan(thin.creaseWidthPx);
    expect(thin.creaseWidthPx).toBeGreaterThan(0);
  });

  it('paints an opaque backdrop by default', () => {
    // The Simulate workspace's panel fills its pane; anything showing through
    // there would be the app chrome behind it.
    expect(resolveRenderSettings(themed(), DEFAULT_SIMULATOR_SETTINGS).backgroundAlpha).toBe(1);
  });

  it('clears to nothing for a transparent surface', () => {
    // An inline window sits on the crease pattern. Clearing to an opaque colour
    // is what made it read as a hole punched in the drawing.
    expect(
      resolveRenderSettings(themed(), DEFAULT_SIMULATOR_SETTINGS, {
        transparentBackground: true,
      }).backgroundAlpha,
    ).toBe(0);
  });

  it('keeps the background colour either way', () => {
    // Alpha alone decides visibility; dropping the colour would change what a
    // translucent surface blends toward if one is ever wanted.
    const styles = themed({ '--bg-canvas': '#010203' });
    const opaque = resolveRenderSettings(styles, DEFAULT_SIMULATOR_SETTINGS);
    const clear = resolveRenderSettings(styles, DEFAULT_SIMULATOR_SETTINGS, {
      transparentBackground: true,
    });
    expect(clear.background).toEqual(opaque.background);
  });

  it('is the single source both render paths draw from', () => {
    // The regression this pins. There used to be two resolutions and they
    // disagreed: the canvas-2D path took mountains from --status-danger and
    // valleys from --accent-primary (teal) while the GPU and SVG paths used
    // #db1f24 and #1c5cd9. A fold profile forces the canvas-2D path even with
    // WebGL2 available, so that was what every segment simulation drew.
    const styles = themed({ '--status-danger': '#e06c75', '--accent-primary': '#5fb3a5' });
    const paint = resolveSimulatorPaint(styles, DEFAULT_SIMULATOR_SETTINGS);
    expect(hex(paint.render.mountainColor)).toBe(DEFAULT_MOUNTAIN_COLOR);
    expect(hex(paint.render.valleyColor)).toBe(DEFAULT_VALLEY_COLOR);
    // And the canvas-2D-only inks are separate, not a second copy of these.
    expect(paint.chrome.highlight).toBeTruthy();
  });

  it('carries hidden lines outside RenderSettings, where only one path honours them', () => {
    const paint = resolveSimulatorPaint(themed(), settingsWith({ showHiddenLines: true }));
    expect(paint.showHiddenLines).toBe(true);
    expect('showHiddenLines' in paint.render).toBe(false);
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

describe('flattening a crease style', () => {
  it('leaves colour styles undashed and per-kind coloured', () => {
    const settings = resolveRenderSettings(themed(), settingsWith({ creaseStyle: 'color' }));
    expect(settings.creaseDash).toBeUndefined();
    expect(hex(settings.mountainColor)).toBe(DEFAULT_MOUNTAIN_COLOR);
    expect(hex(settings.valleyColor)).toBe(DEFAULT_VALLEY_COLOR);
  });

  it('paints every crease in the edge ink under a mono style', () => {
    const styles = themed({ '--text-primary': '#223344' });
    for (const creaseStyle of ['mono', 'mono-dashed'] as const) {
      const settings = resolveRenderSettings(styles, settingsWith({ creaseStyle }));
      expect(hex(settings.mountainColor)).toBe('#223344');
      expect(hex(settings.valleyColor)).toBe('#223344');
      expect(hex(settings.borderColor)).toBe('#223344');
    }
  });

  it('overrides a per-kind colour rather than sitting alongside it', () => {
    // "Mono" means one ink; honouring a mountain override there would make the
    // style a suggestion.
    const settings = resolveRenderSettings(
      themed({ '--text-primary': '#223344' }),
      settingsWith({ creaseStyle: 'mono', mountainColor: '#ff0000' }),
    );
    expect(hex(settings.mountainColor)).toBe('#223344');
  });

  it('dashes only the dashed style, and only folds', () => {
    expect(creaseDashFor('color')).toBeUndefined();
    expect(creaseDashFor('mono')).toBeUndefined();
    const dash = creaseDashFor('mono-dashed')!;
    // Oriedita's own patterns, so a crease dashes the same here as in the CP.
    expect(dash.mountain).toEqual(ORIEDITA_DASH_ONE_DOT);
    expect(dash.valley).toEqual(ORIEDITA_DASH_VALLEY);
    // A paper boundary is not a fold.
    expect(dash.border).toBeNull();
  });

  it('reports whether the style is using dash as a signal', () => {
    // What the hidden-line pass consults so the two never compete: on a folded
    // form a dashed line conventionally means "behind a layer".
    expect(creaseStyleDashes('color')).toBe(false);
    expect(creaseStyleDashes('mono')).toBe(false);
    expect(creaseStyleDashes('mono-dashed')).toBe(true);
  });

  it('carries the dash onto the settings every renderer reads', () => {
    const settings = resolveRenderSettings(themed(), settingsWith({ creaseStyle: 'mono-dashed' }));
    expect(settings.creaseDash?.mountain).toEqual(ORIEDITA_DASH_ONE_DOT);
  });
});
