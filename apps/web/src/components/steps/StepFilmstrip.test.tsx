import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TooltipProvider } from '../ui/Tooltip';
import { StepFilmstrip, type StepFilmstripCard, type StepFilmstripProps } from './StepFilmstrip';

/**
 * What the shared strip leaves to its caller: the pictures and the words.
 * References' own behaviour — focus, swipes, the phone's chevrons, windowing —
 * is pinned by `ReferencesStepFilmstrip.test.tsx`, which drives this strip.
 *
 * jsdom lays nothing out, so the virtualizer is handed widths through
 * `offsetWidth` (as there): a 600px scroller, and 136px per card.
 */
const realOffsetWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth');

function widthFor(element: HTMLElement): number {
  const role = element.getAttribute?.('role');
  if (role === 'listitem') return 136;
  if (role === 'list') return Number.parseFloat(element.style.width || '0');
  if (element.firstElementChild?.getAttribute('role') === 'list') return 600;
  return 0;
}

/** A caller's card: the strip's fields, plus whatever its picture needs. */
interface BranchCard extends StepFilmstripCard {
  picture: string;
}

const card = (key: string, fields: Partial<BranchCard>): BranchCard => ({
  key,
  kind: 'fold',
  number: null,
  badge: '',
  sentence: '',
  ways: null,
  picture: key,
  ...fields,
});

const steps: BranchCard[] = [
  card('half', { number: 1, sentence: 'Valley fold in half.' }),
  card('corner', { number: 2, badge: 'Valley', ways: { count: 2, index: 0 } }),
  card('turn', { kind: 'turn-over', badge: 'Turn over', sentence: 'Turn over.' }),
  card('pending', {
    number: 3,
    badge: 'Preview',
    sentence: 'Fold the flap up.',
    state: 'preview',
    tag: 'Next',
  }),
  card('refused', { number: 3, badge: 'Blocked', state: 'blocked' }),
];

let root: Root | null = null;
let container: HTMLDivElement | null = null;
let readouts: Array<[string, boolean]> = [];

const noop = () => {};

function show(props: Partial<StepFilmstripProps<BranchCard>> = {}): void {
  act(() => {
    root?.render(
      <TooltipProvider>
        <StepFilmstrip<BranchCard>
          steps={steps}
          renderThumbnail={(step) => <svg data-picture={step.picture} />}
          label="Sequence steps"
          activeStep={1}
          onSelectStep={noop}
          onPrevious={noop}
          onNext={noop}
          placeholder="No steps yet"
          previousLabel="Previous step"
          nextLabel="Next step"
          previousDisabled={false}
          nextDisabled={false}
          onPreviousWay={noop}
          onNextWay={noop}
          previousWayLabel="Previous branch"
          nextWayLabel="Next branch"
          waysLabel="Branches at this step"
          wayReadout={(ways, short) => {
            const n = `${ways.index + 1}/${ways.count}`;
            readouts.push([n, short]);
            return short ? n : `Branch ${ways.index + 1} of ${ways.count}`;
          }}
          {...props}
        />
      </TooltipProvider>
    );
  });
}

const cards = () => [
  ...(container?.querySelectorAll(
    '[role="list"][aria-label="Sequence steps"] [role="listitem"] > button'
  ) ?? []),
];
const waysRow = () =>
  container?.querySelector('[role="group"][aria-label="Branches at this step"]') ?? null;

beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
    configurable: true,
    get(this: HTMLElement) {
      return widthFor(this);
    },
  });
  Element.prototype.scrollTo ??= () => {};
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  readouts = [];
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

describe('a compact strip', () => {
  it('is marked compact only when asked, and keeps every card and picture', () => {
    show();
    expect(container?.querySelector('[data-compact]')).toBeNull();
    show({ compact: true });
    expect(container?.querySelector('[data-compact]')).not.toBeNull();
    expect(cards()).toHaveLength(steps.length);
  });
});

describe('the picture slot', () => {
  it('draws each card’s picture from the caller, inside the card', () => {
    show();
    expect(cards().map((c) => c.querySelector('svg')?.getAttribute('data-picture'))).toEqual([
      'half',
      'corner',
      'turn',
      'pending',
      'refused',
    ]);
  });

  it('marks what a card is, for its frame and its badge’s corner', () => {
    show();
    expect(cards().map((c) => c.getAttribute('data-kind'))).toEqual([
      'fold',
      'fold',
      'turn-over',
      'fold',
      'fold',
    ]);
  });
});

describe('a sequence being built', () => {
  it('marks where each card stands, and leaves a committed step unmarked', () => {
    show();
    expect(cards().map((c) => c.getAttribute('data-state'))).toEqual([
      null,
      null,
      null,
      'preview',
      'blocked',
    ]);
  });

  it('puts the active card’s tag ahead of its number and sentence', () => {
    show({ activeStep: 3 });
    const caption = [...(container?.querySelectorAll('p') ?? [])].find((p) =>
      p.textContent?.includes('Fold the flap up.')
    );
    expect(caption?.textContent).toBe('Next3. Fold the flap up.');
    show({ activeStep: 0 });
    expect(container?.textContent).not.toContain('Next');
  });
});

describe('the caller’s words', () => {
  it('names the strip and a card’s ways with them', () => {
    show();
    const dots = cards()[1].querySelector('[role="img"]');
    expect(dots?.getAttribute('aria-label')).toBe('Branch 1 of 2');
    expect(waysRow()?.textContent).toContain('Branch 1 of 2');
  });

  it('asks for the short readout on the phone, where the row is the readout alone', () => {
    show({ navigation: false });
    expect(waysRow()?.textContent).toContain('1/2');
    expect(readouts).toContainEqual(['1/2', true]);
  });

  it('makes the phone’s readout the switch when the caller can cycle the ways, and only there', () => {
    let cycled = 0;
    const cycle = () => void cycled++;
    show({ navigation: false, onCycleWay: cycle, cycleWayLabel: 'Switch branch', cycleWayDisabled: false });
    const readout = waysRow()?.querySelector<HTMLButtonElement>('button[data-cycle]');
    expect(readout?.textContent).toBe('1/2');
    expect(readout?.title).toBe('Switch branch');
    act(() => readout?.click());
    expect(cycled).toBe(1);
    // Read only beside the chevrons, and without the verb.
    show({ onCycleWay: cycle });
    expect(waysRow()?.querySelector('button[data-cycle]')).toBeNull();
    show({ navigation: false, onCycleWay: undefined });
    expect(waysRow()?.querySelector('button[data-cycle]')).toBeNull();
  });
});
