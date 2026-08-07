import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OristudioBpFlap, OristudioBpStretch } from '../../engine/oristudioBpTypes';
import { TooltipProvider } from '../ui/Tooltip';
import { BpPackingStretchNav } from './BpPackingStretchNav';

function flap(id: number, name = ''): OristudioBpFlap {
  return {
    id,
    vertexId: id,
    name,
    anchor: { x: 0, y: 0 },
    width: 0,
    height: 0,
    radius: 1,
    constrained: true,
  };
}

function stretch(overrides: Partial<OristudioBpStretch> = {}): OristudioBpStretch {
  return {
    id: '10,12',
    flapIds: [10, 12],
    riverIds: [],
    completed: true,
    configIndex: 0,
    configCount: 1,
    patternIndex: 0,
    patternCount: 1,
    patternFound: true,
    regions: [],
    ...overrides,
  };
}

let container: HTMLElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function render(props: Partial<Parameters<typeof BpPackingStretchNav>[0]> = {}) {
  act(() => {
    root.render(
      createElement(TooltipProvider, {
        delayDuration: 0,
        children: createElement(BpPackingStretchNav, {
          stretch: stretch(),
          flaps: [flap(10), flap(12)],
          onSwitchConfig: vi.fn(),
          onSwitchPattern: vi.fn(),
          ...props,
        }),
      })
    );
  });
}

function steppers() {
  return [...container.querySelectorAll('.bp-packing-stretch-nav__stepper')].map(
    (el) => el.querySelector('.bp-packing-stretch-nav__label')?.textContent
  );
}

describe('BpPackingStretchNav', () => {
  it('names the stretch by its flaps, not its id', () => {
    render();
    expect(container.querySelector('.bp-packing-stretch-nav__title')?.textContent).toBe(
      'Stretch K and M'
    );
  });

  it('uses a flap name over its letter default', () => {
    render({ flaps: [flap(10, 'Head'), flap(12)] });
    expect(container.querySelector('.bp-packing-stretch-nav__title')?.textContent).toBe(
      'Stretch Head and M'
    );
  });

  it('keeps the full title reachable when CSS ellipsizes it', () => {
    // Flap names are user text of any length; the pill is bounded by the pane,
    // so the title is truncated visually and has to stay readable on hover and
    // to assistive tech.
    render({ flaps: [flap(10, 'left back leg'), flap(12, 'tail blah blah')] });
    const title = container.querySelector('.bp-packing-stretch-nav__title');
    expect(title?.getAttribute('title')).toBe('Stretch left back leg and tail blah blah');
    expect(container.querySelector('.bp-packing-stretch-nav')?.getAttribute('aria-label')).toBe(
      'Stretch left back leg and tail blah blah pattern navigation'
    );
  });

  it('shows no stepper when there is one configuration and one pattern', () => {
    // Upstream's rule: its Store gadget is `v-if="size > 1"`, and its stretch
    // panel replaces both steppers with a sentence in this case.
    render();
    expect(steppers()).toEqual([]);
    expect(container.querySelector('.bp-packing-stretch-nav__note')?.textContent).toBe(
      'Only one pattern'
    );
  });

  it('shows only Pattern when the configuration is the only one', () => {
    render({ stretch: stretch({ patternCount: 2 }) });
    expect(steppers()).toEqual(['Pattern']);
    expect(container.querySelector('.bp-packing-stretch-nav__note')).toBeNull();
  });

  it('shows only Config when its pattern is the only one', () => {
    render({ stretch: stretch({ configCount: 3 }) });
    expect(steppers()).toEqual(['Config']);
  });

  it('shows both when both have alternatives', () => {
    render({ stretch: stretch({ configCount: 3, patternCount: 2 }) });
    expect(steppers()).toEqual(['Config', 'Pattern']);
  });

  it('counts from one, not from zero', () => {
    render({ stretch: stretch({ patternIndex: 1, patternCount: 2 }) });
    expect(container.querySelector('.bp-packing-stretch-nav__count')?.textContent).toBe('2/2');
  });

  it('offers no picker at all for a stretch with no pattern', () => {
    render({
      stretch: stretch({ configCount: 0, patternCount: 0, patternFound: false }),
    });
    expect(steppers()).toEqual([]);
    expect(container.querySelector('.bp-packing-stretch-nav__note')).toBeNull();
    expect(container.querySelector('.bp-packing-stretch-nav__warning')?.textContent).toBe(
      'No valid pattern'
    );
  });

  it('steps with wraparound deltas', () => {
    const onSwitchPattern = vi.fn();
    render({ stretch: stretch({ patternCount: 2 }), onSwitchPattern });
    const buttons = container.querySelectorAll('.bp-packing-stretch-nav__stepper button');
    act(() => (buttons[0] as HTMLButtonElement).click());
    act(() => (buttons[1] as HTMLButtonElement).click());
    expect(onSwitchPattern.mock.calls).toEqual([[-1], [1]]);
  });
});
