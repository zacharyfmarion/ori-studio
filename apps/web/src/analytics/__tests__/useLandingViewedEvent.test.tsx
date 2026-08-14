import { act, createElement, useRef, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PostHogClientLike } from '../bootstrap';
import type { LandingSurface } from '../events';
import { AnalyticsRuntimeProvider } from '../runtime';
import {
  useLandingSectionViewedEvents,
  useLandingViewedEvent,
} from '../useLandingViewedEvent';

function makeFakeClient() {
  return {
    init: vi.fn(),
    register: vi.fn(),
    opt_in_capturing: vi.fn(),
    opt_out_capturing: vi.fn(),
    identify: vi.fn(),
    capture: vi.fn(),
    reset: vi.fn(),
  } satisfies PostHogClientLike;
}

function events(client: ReturnType<typeof makeFakeClient>, name: string) {
  return client.capture.mock.calls.filter((call) => call[0] === name).map((call) => call[1]);
}

/**
 * A controllable `IntersectionObserver`. jsdom has none, and the real one never
 * fires without layout, so the test drives intersections itself.
 */
class FakeObserver {
  static instances: FakeObserver[] = [];
  observed = new Set<Element>();
  unobserved: Element[] = [];
  disconnected = false;

  constructor(
    private readonly callback: IntersectionObserverCallback,
    readonly options?: IntersectionObserverInit
  ) {
    FakeObserver.instances.push(this);
  }

  observe(element: Element) {
    this.observed.add(element);
  }

  unobserve(element: Element) {
    this.observed.delete(element);
    this.unobserved.push(element);
  }

  disconnect() {
    this.disconnected = true;
    this.observed.clear();
  }

  /**
   * Fire the callback for `elements` as if they had scrolled into view.
   *
   * Elements no longer observed are dropped, as the real observer drops them —
   * otherwise the fake would report intersections that can never happen and the
   * fire-once guarantee would look broken when it is not.
   */
  enter(...elements: Element[]) {
    const entries = elements
      .filter((element) => this.observed.has(element))
      .map((target) => ({ target, isIntersecting: true }) as IntersectionObserverEntry);
    if (entries.length === 0) return;
    act(() => this.callback(entries, this as unknown as IntersectionObserver));
  }
}

let container: HTMLElement;
let root: Root;

beforeEach(() => {
  localStorage.clear();
  FakeObserver.instances = [];
  vi.stubGlobal('IntersectionObserver', FakeObserver);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function render(client: PostHogClientLike, node: ReactNode) {
  act(() => {
    root.render(createElement(AnalyticsRuntimeProvider, { client, children: node }));
  });
}

describe('useLandingViewedEvent', () => {
  function Probe({ surface }: { surface: LandingSurface }) {
    useLandingViewedEvent(surface);
    return null;
  }

  it('reports which register the page drew', () => {
    const client = makeFakeClient();
    render(client, createElement(Probe, { surface: 'phone' }));
    expect(events(client, 'landing viewed')).toEqual([{ surface: 'phone' }]);
  });

  it('refires when the register changes — the escape hatch flips it', () => {
    const client = makeFakeClient();
    render(client, createElement(Probe, { surface: 'phone' }));
    render(client, createElement(Probe, { surface: 'desktop' }));
    expect(events(client, 'landing viewed')).toEqual([{ surface: 'phone' }, { surface: 'desktop' }]);
  });
});

describe('useLandingSectionViewedEvents', () => {
  const SECTIONS = [
    { id: 'landing-what', section: 'what' },
    { id: 'landing-get', section: 'get' },
  ] as const;

  function Probe() {
    const ref = useRef<HTMLDivElement | null>(null);
    useLandingSectionViewedEvents(ref, SECTIONS);
    return createElement(
      'div',
      { ref },
      createElement('section', { id: 'landing-what' }),
      createElement('section', { id: 'landing-get' })
    );
  }

  function setup() {
    const client = makeFakeClient();
    render(client, createElement(Probe));
    const observer = FakeObserver.instances.at(-1);
    expect(observer).toBeDefined();
    return { client, observer: observer as FakeObserver };
  }

  it('observes against the scroll container, not the viewport', () => {
    // The page scrolls inside an element, so a null root would never intersect.
    const { observer } = setup();
    expect(observer.options?.root).toBe(container.querySelector('div'));
  });

  it('reports a section the first time it scrolls in', () => {
    const { client, observer } = setup();
    observer.enter(container.querySelector('#landing-get')!);
    expect(events(client, 'landing section viewed')).toEqual([{ section: 'get' }]);
  });

  it('reports each section once, however often it scrolls back past', () => {
    const { client, observer } = setup();
    const what = container.querySelector('#landing-what')!;

    observer.enter(what);
    // The unobserve is what makes it once — not a flag the caller could forget.
    expect(observer.unobserved).toContain(what);
    observer.enter(what);

    expect(events(client, 'landing section viewed')).toEqual([{ section: 'what' }]);
  });

  it('stops observing when the page unmounts', () => {
    const { observer } = setup();
    act(() => root.unmount());
    expect(observer.disconnected).toBe(true);
    // The shared afterEach unmounts again; re-create so it has a live root.
    root = createRoot(container);
  });
});
