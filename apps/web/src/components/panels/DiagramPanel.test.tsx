import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readDiagram } from '../../diagram/document/diagramFile';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { TooltipProvider } from '../ui/Tooltip';
import { DiagramPanel } from './DiagramPanel';

/**
 * The Diagram workspace through the store: what it shows for no diagram, what
 * Add step and the grid do to the store, and the header's title.
 */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const initialState = useWorkspaceStore.getInitialState();
let root: Root | null = null;
let host: HTMLDivElement | null = null;

beforeEach(() => {
  useWorkspaceStore.setState(initialState, true);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  act(() =>
    root?.render(
      <TooltipProvider>
        <DiagramPanel />
      </TooltipProvider>
    )
  );
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  host?.remove();
  host = null;
});

const state = () => useWorkspaceStore.getState();
const buttonNamed = (name: string) =>
  [...(host?.querySelectorAll('button') ?? [])].find((button) => button.textContent === name) as
    | HTMLButtonElement
    | undefined;
const options = () => [...(host?.querySelectorAll('[role="option"]') ?? [])] as HTMLElement[];
const titleField = () => host?.querySelector('input[aria-label="Diagram title"]') as HTMLInputElement;
const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;

function type(input: HTMLInputElement, value: string) {
  act(() => {
    setValue.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

describe('DiagramPanel', () => {
  it('opens on an empty state without making a diagram', () => {
    expect(host?.textContent).toContain('Start a diagram');
    expect(state().diagram).toBeNull();
    expect(state().dirty).toBe(false);
  });

  it('adds a step from the empty state, then from the header, each selected and counted', () => {
    act(() => buttonNamed('Add step')?.click());
    expect(state().diagram?.steps).toHaveLength(1);
    expect(options()).toHaveLength(1);
    expect(options()[0].getAttribute('aria-selected')).toBe('true');
    expect(host?.textContent).toContain('1 step');

    // The header's Add step: after the selected step.
    act(() => buttonNamed('Add step')?.click());
    expect(options()).toHaveLength(2);
    expect(options()[1].getAttribute('aria-selected')).toBe('true');
    expect(host?.textContent).toContain('2 steps');
  });

  it('selects a card on click and drops the selection on a click between cards', () => {
    act(() => buttonNamed('Add step')?.click());
    act(() => buttonNamed('Add step')?.click());
    act(() => options()[0].click());
    expect(state().diagramSelectedStepId).toBe(state().diagram?.steps[0].id);
    act(() => (host?.querySelector('[role="listbox"]') as HTMLElement).click());
    expect(state().diagramSelectedStepId).toBeNull();
    expect(state().diagram?.steps).toHaveLength(2);
  });

  it('renames the diagram on blur, and Escape keeps the old title', () => {
    act(() => titleField().focus());
    type(titleField(), 'Crane');
    act(() => titleField().blur());
    expect(state().diagram?.title).toBe('Crane');

    act(() => titleField().focus());
    type(titleField(), 'Crane, revised');
    act(() => {
      titleField().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(state().diagram?.title).toBe('Crane');
    expect(titleField().value).toBe('Crane');
  });

  it('says a newer build’s diagram is read-only, and offers nothing that would change it', () => {
    act(() =>
      state().installDiagram(
        readDiagram({ formatVersion: 99, id: 'diagram-x', title: 'Future', steps: [{ id: 's1', text: 'Hi' }] })
      )
    );
    expect(host?.textContent).toContain('opens read-only');
    expect(buttonNamed('Add step')?.disabled).toBe(true);
    expect(titleField().disabled).toBe(true);
  });
});
