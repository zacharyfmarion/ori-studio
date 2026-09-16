import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TooltipProvider } from '../../components/ui/Tooltip';
import { ReferencesStepFilmstrip } from './ReferencesStepFilmstrip';
import type { ReferencesFilmstripStep } from './referencesFilmstrip';

/**
 * One active card, however it was chosen.
 *
 * Clicking a card focuses it as well as selecting it; the arrow chords go
 * through the focus-independent shortcut runtime and only select. Left alone,
 * the browser's own focus ring stayed on the last card clicked while the
 * selection moved away from it — two highlighted cards in two different
 * colours, and the stale one was still the Enter/Space target, so activating it
 * snapped the selection backwards.
 */

/**
 * jsdom gives every element a zero-size box, so the virtualizer would see a
 * viewport of width 0 and mount no cards at all.
 *
 * Both measurements it takes go through `offsetWidth` — the scroll element's,
 * via virtual-core's `getRect`, and each card's, via `measureElement`. Patched
 * on the prototype for the same reason `CpDiagnosticHud.test.tsx` does it: the
 * elements do not exist until the strip renders, and by then the measurement
 * has already happened.
 *
 * The numbers are the stylesheet's: a card is 128px wide with an 8px gap after
 * it, and the viewport here is wide enough for every card in the fixture, so
 * the window is not what any assertion below turns on.
 */
const STRIP_VIEWPORT_PX = 600;
const CARD_PX = 136;

const realOffsetWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth');

function widthFor(element: HTMLElement): number {
  if (element.classList?.contains('references-filmstrip__list')) return STRIP_VIEWPORT_PX;
  if (element.classList?.contains('references-filmstrip__item')) return CARD_PX;
  if (element.classList?.contains('references-filmstrip__track')) {
    return Number.parseFloat(element.style.width || '0');
  }
  return 0;
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;

const steps: ReferencesFilmstripStep[] = [0, 1, 2].map((i) => ({
  key: `k${i}`,
  kind: 'fold',
  badge: '',
  number: i + 1,
  diagram: null,
  primitives: null,
  mirrored: false,
  sentence: `step ${i + 1}`,
}));

function show(activeStep: number): void {
  act(() => {
    root?.render(
      // The chevrons are IconButtons, which are tooltip triggers.
      <TooltipProvider>
        <ReferencesStepFilmstrip
          steps={steps}
          activeStep={activeStep}
          onSelectStep={() => {}}
          onPrevious={() => {}}
          onNext={() => {}}
          placeholder=""
          note=""
          previousLabel="Previous"
          nextLabel="Next"
          previousDisabled={false}
          nextDisabled={false}
        />
      </TooltipProvider>
    );
  });
}

const cards = () => [...(container?.querySelectorAll('button.references-card') ?? [])];

beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
    configurable: true,
    get(this: HTMLElement) {
      return widthFor(this);
    },
  });
  // The virtualizer scrolls the active card into view; jsdom has no scrolling.
  Element.prototype.scrollTo ??= () => {};
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  if (realOffsetWidth) {
    Object.defineProperty(HTMLElement.prototype, 'offsetWidth', realOffsetWidth);
  }
});

describe('the active card', () => {
  it('takes focus with the selection when the strip already owns it', () => {
    show(0);
    (cards()[0] as HTMLButtonElement).focus();
    expect(document.activeElement).toBe(cards()[0]);

    show(2);
    expect(document.activeElement).toBe(cards()[2]);
    expect(cards()[2].getAttribute('aria-current')).toBe('step');
    expect(cards()[0].getAttribute('aria-current')).toBeNull();
    // Exactly one card is marked, whichever way it was reached.
    expect(cards().filter((c) => c.className.includes('references-card--selected'))).toHaveLength(1);
  });

  // A fresh plan resets the active step to 0. Taking focus then would pull it
  // off the canvas the reader is actually working in.
  it('leaves focus alone when it is somewhere else', () => {
    const outside = document.createElement('button');
    document.body.append(outside);
    show(0);
    outside.focus();

    show(1);
    expect(document.activeElement).toBe(outside);
    outside.remove();
  });
});

describe('the windowed strip', () => {
  // Each card draws every crease made up to its own step, so mounting the whole
  // strip costs about half of steps x creases — 700k SVG elements on the corpus
  // p99. Only what is in view is built.
  it('reports its whole length while mounting only what is in view', () => {
    show(0);
    const cards = [...(container?.querySelectorAll('button.references-card') ?? [])];
    expect(cards).toHaveLength(steps.length);
    for (const [i, card] of cards.entries()) {
      expect(card.getAttribute('aria-posinset')).toBe(String(i + 1));
      expect(card.getAttribute('aria-setsize')).toBe(String(steps.length));
    }
    // The scrollbar is the plan's length, not the window's.
    const track = container?.querySelector<HTMLElement>('.references-filmstrip__track');
    expect(Number.parseFloat(track?.style.width ?? '0')).toBe(steps.length * CARD_PX);
  });
});
