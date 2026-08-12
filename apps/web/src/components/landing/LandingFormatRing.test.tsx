import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { OPENABLE_FILE_EXTENSIONS } from '../../lib/fileDrop';
import { NATIVE_PROJECT_EXTENSION } from '../../lib/nativeProjectFile';
import { LandingFormatRing, RING_EXTENSIONS } from './LandingFormatRing';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function renderRing(): HTMLDivElement {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  act(() => root?.render(<LandingFormatRing />));
  return container;
}

afterEach(() => {
  if (root) act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

describe('LandingFormatRing', () => {
  it('offers every format the app will actually open', () => {
    // The point of deriving from OPENABLE_FILE_EXTENSIONS rather than retyping
    // the list: a format on the ring that the Open dialog does not accept is a
    // promise the app cannot keep.
    for (const extension of OPENABLE_FILE_EXTENSIONS) {
      if (extension === NATIVE_PROJECT_EXTENSION) continue;
      expect(RING_EXTENSIONS).toContain(extension);
    }
  });

  it('keeps the native project format out of the orbit and in the hub', () => {
    const rendered = renderRing();
    const orbit = Array.from(rendered.querySelectorAll('.landing-ring__slot .landing-file__ext'))
      .map((file) => file.textContent);

    expect(orbit).not.toContain(`.${NATIVE_PROJECT_EXTENSION}`);
    expect(rendered.querySelector('.landing-ring__hub .landing-file__ext')?.textContent).toBe(
      `.${NATIVE_PROJECT_EXTENSION}`
    );
  });

  it('carries the image formats, which export but never open', () => {
    const rendered = renderRing();
    const shown = Array.from(rendered.querySelectorAll('.landing-file__ext')).map(
      (file) => file.textContent
    );

    expect(shown).toContain('.svg');
    expect(shown).toContain('.png');
    // ...and they are exports only, so the Open dialog must not list them.
    expect(OPENABLE_FILE_EXTENSIONS).not.toContain('svg');
  });

  it('gives the ring the slot count and index its layout positions from', () => {
    const rendered = renderRing();
    const ring = rendered.querySelector<HTMLElement>('.landing-ring');
    const slots = Array.from(rendered.querySelectorAll<HTMLElement>('.landing-ring__slot'));

    // The CSS divides a turn by --ring-count and multiplies by --slot; if either
    // goes missing every file stacks at the top of the circle.
    expect(ring?.style.getPropertyValue('--ring-count')).toBe(String(RING_EXTENSIONS.length));
    expect(slots).toHaveLength(RING_EXTENSIONS.length);
    expect(slots.map((slot) => slot.style.getPropertyValue('--slot'))).toEqual(
      RING_EXTENSIONS.map((_, index) => String(index))
    );
  });

  it('names the list for anyone who cannot see the arrangement', () => {
    const rendered = renderRing();
    expect(rendered.querySelector('ul')?.getAttribute('aria-label')).toBe(
      'Supported file formats'
    );
  });
});
