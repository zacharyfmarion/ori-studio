import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import type { FoldHit } from '../canvas/foldPicking';
import { useFoldRepeatMarks } from './useFoldRepeatMarks';
import type { FoldRepeatTool } from './useFoldRepeatTool';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it('keeps the axis under the pointer on one pane while the other pane, without the pointer, says nothing', () => {
  const hoverAxis = vi.fn();
  const repeat = { marks: null, verbs: { hoverAxis } } as unknown as FoldRepeatTool;
  let seen: ReturnType<typeof useFoldRepeatMarks> | null = null;
  function Probe() {
    seen = useFoldRepeatMarks(null, null, repeat, null);
    return null;
  }
  const root = createRoot(document.createElement('div'));
  act(() => root.render(<Probe />));
  const on = (repeatAxis?: number): FoldHit => ({ pane: 'crease-pattern', at: { x: 0, y: 0 }, pick: null, ...(repeatAxis === undefined ? {} : { repeatAxis }) });
  seen!.onCreaseHover(on(1));
  expect(hoverAxis).toHaveBeenLastCalledWith(1);
  // The folded pane re-reads what is under no pointer on it: the crease pattern's axis stays.
  seen!.onFoldedHover(null);
  expect(hoverAxis).toHaveBeenLastCalledWith(1);
  seen!.onFoldedHover({ ...on(0), pane: 'folded' });
  expect(hoverAxis).toHaveBeenLastCalledWith(1);
  // The pointer leaves the crease pattern: the folded pane's, then none.
  seen!.onCreaseHover(null);
  expect(hoverAxis).toHaveBeenLastCalledWith(0);
  seen!.onFoldedHover(on());
  expect(hoverAxis).toHaveBeenLastCalledWith(null);
  act(() => root.unmount());
});
