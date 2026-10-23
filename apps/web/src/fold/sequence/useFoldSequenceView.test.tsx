import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FoldPendingStep } from '../session/foldSessionState';
import { useAnsweredPendingStep } from './useFoldSequenceView';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const PARENT = { generation: 1, id: 7 };
const valley = (flaps: number) => ({ op: { kind: 'valley', flaps } }) as never;
const landed = (flaps: number, parent = PARENT): FoldPendingStep =>
  ({ status: 'landed', request: valley(flaps), parent, state: { generation: 1, id: 20 + flaps }, summary: {}, report: null }) as never;
const working = (flaps: number, parent = PARENT): FoldPendingStep => ({ status: 'working', request: valley(flaps), parent });

let shown: FoldPendingStep | null = null;
function Probe({ pending }: { pending: FoldPendingStep }) {
  const step = useAnsweredPendingStep(pending);
  useEffect(() => {
    shown = step;
  });
  return null;
}

let root: Root | null = null;
beforeEach(() => {
  root = createRoot(document.createElement('div'));
  shown = null;
});
afterEach(() => {
  act(() => root?.unmount());
  root = null;
});
const render = (pending: FoldPendingStep) => act(() => root?.render(<Probe pending={pending} />));

describe('the pending step the strip, the sentence and the Step pane show (owner report, 2026-10-21)', () => {
  it('stays the last one answered while a new seed’s folds from the same state, until it lands', () => {
    const first = landed(1);
    render(first);
    expect(shown).toBe(first);

    // Another flap picked: folding, from the same state. The card does not go.
    render(working(2));
    expect(shown).toBe(first);

    const second = landed(2);
    render(second);
    expect(shown).toBe(second);
  });

  it('lets it go once nothing is folding, or the fold is from another state', () => {
    render(landed(1));
    render({ status: 'idle' });
    expect(shown).toEqual({ status: 'idle' });

    render(landed(1));
    const elsewhere = working(2, { generation: 1, id: 8 });
    render(elsewhere);
    expect(shown).toBe(elsewhere);
  });
});
