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
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
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
