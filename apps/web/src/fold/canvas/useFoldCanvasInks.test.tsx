import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import { referencesGroundInk } from '../../themes/referencesInk';
import { useFoldCanvasInks, type FoldCanvasInks } from './useFoldCanvasInks';

function groundOf(background: string): string {
  const element = document.createElement('div');
  element.style.setProperty('--bg-primary', background);
  document.body.append(element);
  let inks: FoldCanvasInks | null = null;
  function Probe() {
    inks = useFoldCanvasInks(element, 'theme');
    return null;
  }
  const host = document.createElement('div');
  const root = createRoot(host);
  act(() => root.render(<Probe />));
  act(() => root.unmount());
  element.remove();
  const ground = (inks as FoldCanvasInks | null)?.ground;
  if (!ground) throw new Error('no inks');
  return ground;
}

describe('useFoldCanvasInks', () => {
  it('gives the ground as hex, which the ground-ink contrast test reads', () => {
    expect(groundOf('rgb(250, 250, 250)')).toBe('#fafafa');
    expect(groundOf('#282c34')).toBe('#282c34');
  });

  // An arrow off the paper is inked against the ground: black on a light
  // theme's, white on a dark one's. With `rgb()` it read as black, so a light
  // theme drew it white on white.
  it('inks a mark off the paper so it shows on a light ground and a dark one', () => {
    expect(referencesGroundInk('#ffffff', groundOf('#fafafa'))).toBe('#000000');
    expect(referencesGroundInk('#000000', groundOf('#282c34'))).toBe('#ffffff');
  });
});
