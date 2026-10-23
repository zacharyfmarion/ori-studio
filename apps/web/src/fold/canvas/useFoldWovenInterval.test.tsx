import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FoldCrossSection } from '../engine/foldEngineWire';
import type { FoldHit } from './foldPicking';
import { useFoldWovenInterval, type FoldWovenInterval } from './useFoldWovenInterval';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const sectionA = { order: { kind: 'woven' } } as unknown as FoldCrossSection;
const sectionB = { order: { kind: 'woven' } } as unknown as FoldCrossSection;

let seen: FoldWovenInterval | null = null;
/** Captured in an effect, which `act` flushes. */
function Probe({ section }: { section: FoldCrossSection | null }) {
  const woven = useFoldWovenInterval(section);
  useEffect(() => {
    seen = woven;
  });
  return null;
}

let root: Root | null = null;
beforeEach(() => {
  root = createRoot(document.createElement('div'));
});
afterEach(() => act(() => root?.unmount()));

const render = (section: FoldCrossSection | null) => act(() => root?.render(<Probe section={section} />));
const hover = (hit: FoldHit | null) => act(() => seen?.onHover(hit));
const over = (interval?: number): FoldHit => ({
  pane: 'folded',
  at: { x: 0, y: 0 },
  pick: null,
  ...(interval === undefined ? {} : { interval }),
});

describe('the woven stack on show', () => {
  it('follows the interval under the pointer, and keeps it when the pointer leaves', () => {
    render(sectionA);
    expect(seen?.interval).toBeNull();
    hover(over(1));
    expect(seen?.interval).toBe(1);
    // Off the line's ends, off the pane: the stack stays.
    hover(over());
    hover(null);
    expect(seen?.interval).toBe(1);
    hover(over(0));
    expect(seen?.interval).toBe(0);
  });

  it('starts again from the first stack of a new section', () => {
    render(sectionA);
    hover(over(1));
    render(sectionB);
    expect(seen?.interval).toBeNull();
    render(null);
    hover(over(1));
    expect(seen?.interval).toBeNull();
  });
});
