import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createStep, type DiagramStep } from '../../diagram/document/diagramDocument';
import { DiagramStepsGrid } from './DiagramStepsGrid';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  host?.remove();
  host = null;
});

const steps: DiagramStep[] = [
  createStep(() => 'step-a'),
  { ...createStep(() => 'step-b'), text: 'Fold the corner\nto the centre.' },
  { ...createStep(() => 'step-c'), unknown: { id: 'step-c' } },
];

function render(selectedStepId: string | null, onSelect = vi.fn()) {
  if (!host) {
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
  }
  act(() =>
    root?.render(<DiagramStepsGrid steps={steps} selectedStepId={selectedStepId} onSelect={onSelect} />)
  );
  return onSelect;
}

const listbox = () => host?.querySelector('[role="listbox"]') as HTMLElement;
const options = () => [...(host?.querySelectorAll('[role="option"]') ?? [])] as HTMLElement[];

describe('DiagramStepsGrid', () => {
  it('is one listbox of the steps, numbered in order', () => {
    render(null);
    expect(listbox().getAttribute('aria-label')).toBe('Steps');
    expect(options().map((option) => option.textContent)).toEqual([
      'Step 1EmptyNo picture yetNo instruction',
      'Step 2EmptyNo picture yetFold the corner\nto the centre.',
      'Step 3NewerMade with a newer Ori StudioNo instruction',
    ]);
  });

  it('marks the selected card and makes it the tab stop, and no card a button', () => {
    render('step-b');
    expect(options().map((option) => option.getAttribute('aria-selected'))).toEqual([
      'false',
      'true',
      'false',
    ]);
    expect(options().map((option) => option.tabIndex)).toEqual([-1, 0, -1]);
    // A button would turn the grid's arrow keys off the moment it took focus.
    expect(host?.querySelector('button')).toBeNull();
    render(null);
    expect(options().map((option) => option.tabIndex)).toEqual([0, -1, -1]);
  });

  it('reports a click on a card as a selection, and one between cards as none', () => {
    const onSelect = render(null);
    act(() => options()[2].click());
    expect(onSelect).toHaveBeenLastCalledWith('step-c');
    act(() => listbox().click());
    expect(onSelect).toHaveBeenLastCalledWith(null);
  });

  it('moves focus with the selection while focus is in the grid or nowhere, and never takes it from a control', () => {
    const outside = document.createElement('button');
    document.body.append(outside);
    try {
      render('step-a');
      act(() => outside.focus());
      render('step-b');
      expect(document.activeElement).toBe(outside);

      act(() => options()[1].focus());
      render('step-c');
      expect(document.activeElement).toBe(options()[2]);

      // Focus dropped on the page — the focused card was deleted — is picked up.
      act(() => options()[2].blur());
      expect(document.activeElement).toBe(document.body);
      render('step-a');
      expect(document.activeElement).toBe(options()[0]);
    } finally {
      outside.remove();
    }
  });
});
