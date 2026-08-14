import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OPENABLE_FILE_EXTENSIONS } from '../../lib/fileDrop';
import { NATIVE_PROJECT_EXTENSION } from '../../lib/nativeProjectFile';
import { LandingFormatRing, RING_FORMATS } from './LandingFormatRing';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

/** Observers created by the ring, so a test can drive them into view. */
let observers: Array<{ callback: IntersectionObserverCallback; target?: Element }> = [];

class FakeObserver {
  constructor(private readonly callback: IntersectionObserverCallback) {
    observers.push({ callback: this.callback });
  }
  observe(target: Element) {
    const entry = observers.at(-1);
    if (entry) entry.target = target;
  }
  disconnect() {}
  unobserve() {}
}

function scrollIntoView(isIntersecting: boolean) {
  act(() => {
    for (const { callback, target } of observers) {
      callback(
        [{ target, isIntersecting } as IntersectionObserverEntry],
        {} as IntersectionObserver
      );
    }
  });
}

function renderRing(): HTMLDivElement {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  act(() => root?.render(<LandingFormatRing />));
  return container;
}

/** Length of an SVG `<line>` from its own attributes. */
function lengthOf(line: Element): number {
  const at = (name: string) => Number(line.getAttribute(name));
  return Math.hypot(at('x2') - at('x1'), at('y2') - at('y1'));
}

function extensionsWith(direction: string): string[] {
  return RING_FORMATS.filter((format) => format.direction === direction).map(
    (format) => format.extension
  );
}

beforeEach(() => {
  observers = [];
  vi.stubGlobal('IntersectionObserver', FakeObserver);
});

afterEach(() => {
  if (root) act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  vi.unstubAllGlobals();
});

describe('LandingFormatRing', () => {
  it('offers every format the app will actually open', () => {
    // The point of deriving from OPENABLE_FILE_EXTENSIONS rather than retyping
    // the list: a format on the ring that the Open dialog does not accept is a
    // promise the app cannot keep.
    for (const extension of OPENABLE_FILE_EXTENSIONS) {
      if (extension === NATIVE_PROJECT_EXTENSION) continue;
      expect(RING_FORMATS.map((format) => format.extension)).toContain(extension);
    }
  });

  it('marks a format as importable exactly when the app can open it', () => {
    for (const { extension, direction } of RING_FORMATS) {
      const opens = (OPENABLE_FILE_EXTENSIONS as readonly string[]).includes(extension);
      expect(direction === 'import' || direction === 'both').toBe(opens);
    }
  });

  it('classifies the formats that only go one way', () => {
    // Images are written but never read back as a crease pattern; `.tmd` is the
    // reverse — openable, but the TreeMaker exports are v4 and v5.
    expect(extensionsWith('export')).toEqual(['svg', 'png']);
    expect(extensionsWith('import')).toEqual(['tmd']);
  });

  it('keeps the native project format out of the orbit and in the hub', () => {
    const rendered = renderRing();
    const orbit = Array.from(
      rendered.querySelectorAll('.landing-ring__slot .landing-file__ext')
    ).map((file) => file.textContent);

    expect(orbit).not.toContain(`.${NATIVE_PROJECT_EXTENSION}`);
    expect(rendered.querySelector('.landing-ring__hub .landing-file__ext')?.textContent).toBe(
      `.${NATIVE_PROJECT_EXTENSION}`
    );
  });

  it('points an arrowhead the way each format travels', () => {
    const rendered = renderRing();
    const wires = Array.from(rendered.querySelectorAll('.landing-ring__wire'));

    RING_FORMATS.forEach(({ direction }, index) => {
      const wire = wires[index];
      // Inbound head sits at the start of the line, outbound at the end.
      expect(Boolean(wire.getAttribute('marker-start'))).toBe(direction !== 'export');
      expect(Boolean(wire.getAttribute('marker-end'))).toBe(direction !== 'import');
    });
  });

  it('gives a two-way format a flow in each direction', () => {
    const rendered = renderRing();
    const groups = Array.from(rendered.querySelectorAll('.landing-ring__wires g'));

    RING_FORMATS.forEach(({ direction }, index) => {
      const flows = Array.from(groups[index].querySelectorAll('.landing-ring__flow')).map(
        (flow) => flow.getAttribute('data-way')
      );
      if (direction === 'both') expect(flows.sort()).toEqual(['in', 'out']);
      if (direction === 'import') expect(flows).toEqual(['in']);
      if (direction === 'export') expect(flows).toEqual(['out']);
    });
  });

  it('keeps the dash clear of the arrowheads at each end that has one', () => {
    const rendered = renderRing();
    const groups = Array.from(rendered.querySelectorAll('.landing-ring__wires g'));

    RING_FORMATS.forEach(({ direction }, index) => {
      const wire = groups[index].querySelector('.landing-ring__wire')!;
      const flow = groups[index].querySelector('.landing-ring__flow')!;
      const heads = (direction === 'both' ? 2 : 1) * 2.6;
      // The flow is the wire minus one head's depth for every end carrying one,
      // so the dash arrives at the base of the head instead of running under it.
      expect(lengthOf(wire) - lengthOf(flow)).toBeCloseTo(heads, 5);
    });
  });

  it('sets each wire a dash period equal to its own length', () => {
    const rendered = renderRing();
    const groups = Array.from(rendered.querySelectorAll<SVGGElement>('.landing-ring__wires g'));

    for (const group of groups) {
      const declared = group.style.getPropertyValue('--flow-length');
      // A period longer than the wire leaves the dash off the end for part of
      // every cycle, which reads as a broken animation rather than a subtle one.
      expect(Number.parseFloat(declared)).toBeCloseTo(
        lengthOf(group.querySelector('.landing-ring__flow')!),
        1
      );
      // `px` rather than a bare number, so the `calc()` in the stylesheet is
      // given a real length; a unitless one is discarded by stricter engines and
      // the animation freezes.
      expect(declared.trim()).toMatch(/px$/);
    }
  });

  it('runs the flow only while the ring is on screen', () => {
    // Twenty animated strokes against a page nobody has scrolled to is battery,
    // not polish — the CSS keys the animation off this attribute.
    const rendered = renderRing();
    const ring = rendered.querySelector('.landing-ring');

    expect(ring?.hasAttribute('data-flowing')).toBe(false);
    scrollIntoView(true);
    expect(ring?.hasAttribute('data-flowing')).toBe(true);
    scrollIntoView(false);
    expect(ring?.hasAttribute('data-flowing')).toBe(false);
  });

  it('states the direction in text, since the arrows are decorative', () => {
    const rendered = renderRing();
    const spoken = Array.from(rendered.querySelectorAll('.landing-file__direction')).map(
      (label) => label.textContent
    );

    expect(rendered.querySelector('.landing-ring__wires')?.getAttribute('aria-hidden')).toBe('true');
    expect(spoken).toHaveLength(RING_FORMATS.length);
    expect(spoken).toContain('opens and exports');
    expect(spoken).toContain('exports only');
    expect(spoken).toContain('opens only');
  });

  it('gives the ring the slot count and index its layout positions from', () => {
    const rendered = renderRing();
    const ring = rendered.querySelector<HTMLElement>('.landing-ring');
    const slots = Array.from(rendered.querySelectorAll<HTMLElement>('.landing-ring__slot'));

    // The CSS divides a turn by --ring-count and multiplies by --slot; if either
    // goes missing every file stacks at the top of the circle.
    expect(ring?.style.getPropertyValue('--ring-count')).toBe(String(RING_FORMATS.length));
    expect(slots).toHaveLength(RING_FORMATS.length);
    expect(slots.map((slot) => slot.style.getPropertyValue('--slot'))).toEqual(
      RING_FORMATS.map((_, index) => String(index))
    );
  });

  it('names the list for anyone who cannot see the arrangement', () => {
    const rendered = renderRing();
    expect(rendered.querySelector('.landing-ring__orbit')?.getAttribute('aria-label')).toBe(
      'Supported file formats'
    );
  });
});
