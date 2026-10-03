import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { TooltipProvider } from '../ui/Tooltip';
import { DiagramStepPanel } from './DiagramStepPanel';

/**
 * The Step pane through the store: what it says with nothing selected, and
 * what its position field, verbs and instruction do to the selected step.
 */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const initialState = useWorkspaceStore.getInitialState();
let root: Root | null = null;
let host: HTMLDivElement | null = null;

beforeEach(() => {
  vi.useFakeTimers();
  useWorkspaceStore.setState(initialState, true);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  act(() =>
    root?.render(
      <TooltipProvider>
        <DiagramStepPanel />
      </TooltipProvider>
    )
  );
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  host?.remove();
  host = null;
  vi.useRealTimers();
});

const state = () => useWorkspaceStore.getState();
const ids = () => state().diagram?.steps.map((step) => step.id) ?? [];
const button = (label: string) =>
  host?.querySelector(`button[aria-label="${label}"]`) as HTMLButtonElement | null;
const position = () => host?.querySelector('input[aria-label="Step position"]') as HTMLInputElement;
const instruction = () => host?.querySelector('textarea') as HTMLTextAreaElement;

function setField(field: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const prototype = field instanceof HTMLTextAreaElement ? HTMLTextAreaElement : HTMLInputElement;
  act(() => {
    Object.getOwnPropertyDescriptor(prototype.prototype, 'value')!.set!.call(field, value);
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function threeSteps() {
  act(() => {
    state().addDiagramStep();
    state().addDiagramStep();
    state().addDiagramStep();
  });
  return ids();
}

describe('DiagramStepPanel', () => {
  it('asks for a step when there is none, and for a selection when nothing is chosen', () => {
    expect(host?.textContent).toContain('Add a step to write its instruction here.');
    threeSteps();
    act(() => state().selectDiagramStep(null));
    expect(host?.textContent).toContain('Select a step to edit it.');
  });

  it('writes the instruction to the selected step, as one undo step', () => {
    const [, , third] = threeSteps();
    const past = state().diagramHistory.past.length;
    act(() => instruction().focus());
    setField(instruction(), 'Fold');
    act(() => vi.advanceTimersByTime(600));
    setField(instruction(), 'Fold in half.');
    act(() => instruction().blur());
    expect(state().diagram?.steps.find((step) => step.id === third)?.text).toBe('Fold in half.');
    expect(state().diagramHistory.past).toHaveLength(past + 1);
  });

  it('moves the step to a typed position, and puts back one that is not a position', () => {
    const [first, second, third] = threeSteps();
    expect(position().value).toBe('3');
    act(() => position().focus());
    setField(position(), '1');
    act(() => position().blur());
    expect(ids()).toEqual([third, first, second]);
    expect(position().value).toBe('1');

    act(() => position().focus());
    setField(position(), '9');
    act(() => position().blur());
    expect(ids()).toEqual([third, first, second]);
    expect(position().value).toBe('1');
  });

  it('runs the header verbs, disabling the ones that cannot apply', () => {
    const [first, second, third] = threeSteps();
    expect(button('Move Later')?.disabled).toBe(true);
    act(() => button('Move Earlier')?.click());
    expect(ids()).toEqual([first, third, second]);

    act(() => button('Duplicate Step')?.click());
    expect(ids()).toHaveLength(4);
    expect(state().diagramSelectedStepId).toBe(ids()[2]);

    // An empty step goes without a question.
    act(() => button('Delete Step')?.click());
    expect(ids()).toEqual([first, third, second]);
  });
});
