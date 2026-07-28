import { describe, expect, it } from 'vitest';
import { toRenderSettings } from './canvas2dFrame';
import { DEFAULT_SIMULATOR_SETTINGS } from '../lib/simulatorSettings';

function canvas(): HTMLCanvasElement {
  const element = document.createElement('canvas');
  document.body.appendChild(element);
  return element;
}

describe('render settings from a surface', () => {
  it('paints an opaque backdrop by default', () => {
    // The Simulate workspace's panel fills its pane; anything showing through
    // there would be the app chrome behind it.
    expect(toRenderSettings(canvas(), DEFAULT_SIMULATOR_SETTINGS).backgroundAlpha).toBe(1);
  });

  it('clears to nothing for a transparent surface', () => {
    // An inline window sits on the crease pattern. Clearing to an opaque colour
    // is what made it read as a hole punched in the drawing.
    const settings = toRenderSettings(canvas(), DEFAULT_SIMULATOR_SETTINGS, {
      transparentBackground: true,
    });
    expect(settings.backgroundAlpha).toBe(0);
  });

  it('keeps the background colour either way', () => {
    // Alpha alone decides visibility; dropping the colour would change what a
    // translucent surface blends toward if one is ever wanted.
    const opaque = toRenderSettings(canvas(), DEFAULT_SIMULATOR_SETTINGS);
    const clear = toRenderSettings(canvas(), DEFAULT_SIMULATOR_SETTINGS, {
      transparentBackground: true,
    });
    expect(clear.background).toEqual(opaque.background);
  });
});
