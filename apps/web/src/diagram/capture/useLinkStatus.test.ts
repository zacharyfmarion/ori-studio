import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { cpStep } from '../document/diagramSteps.fixtures';
import type { DiagramStep } from '../document/diagramDocument';
import type { DiagramLinkStatus } from './linkStatus';
import { afterEach, expect, it, vi } from 'vitest';
import { createStep } from '../document/diagramDocument';
import { checkLinkStatusesInBackground, useDiagramLinkStatuses } from './useLinkStatus';

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

it('yields between expensive link checks and publishes a complete ordered answer', () => {
  vi.useFakeTimers();
  let time = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => time);
  const steps = ['a', 'b', 'c'].map((id) => createStep(() => id));
  const check = vi.fn(() => { time += 5; return 'current' as const; });
  const publish = vi.fn();
  checkLinkStatusesInBackground(steps, check, publish);
  expect(check).not.toHaveBeenCalled();
  vi.advanceTimersByTime(0);
  expect(check).toHaveBeenCalledTimes(1);
  expect(publish).not.toHaveBeenCalled();
  vi.runAllTimers();
  expect([...publish.mock.calls[0]![0]]).toEqual([['a', 'current'], ['b', 'current'], ['c', 'current']]);
});

it('stops a superseded document before checking or publishing its remaining sources', () => {
  vi.useFakeTimers();
  let time = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => time);
  const check = vi.fn(() => { time += 5; return 'stale' as const; });
  const publish = vi.fn();
  const cancel = checkLinkStatusesInBackground([createStep(), createStep()], check, publish);
  vi.advanceTimersByTime(0);
  cancel();
  vi.runAllTimers();
  expect(check).toHaveBeenCalledTimes(1);
  expect(publish).not.toHaveBeenCalled();
});

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
it('keeps unknown links without an open pattern and discards a replaced steps list', () => {
  vi.useFakeTimers();
  useWorkspaceStore.setState({ oristudioCpDocument: null });
  const root = createRoot(document.createElement('div'));
  let statuses: ReadonlyMap<string, DiagramLinkStatus> = new Map();
  function Links({ steps }: { steps: DiagramStep[] }) {
    statuses = useDiagramLinkStatuses(steps, true);
    return null;
  }
  try {
    act(() => root.render(createElement(Links, { steps: [cpStep('old')] })));
    act(() => root.render(createElement(Links, { steps: [cpStep('latest'), createStep(() => 'unlinked')] })));
    act(() => vi.runAllTimers());
    expect([...statuses]).toEqual([['latest', 'unknown']]);
  } finally { act(() => root.unmount()); }
});
