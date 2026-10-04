import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AnnotationAction, AnnotationActionId } from '../../diagram/annotate/annotationActions';
import { TooltipProvider } from '../ui/Tooltip';
import { DiagramPathNodeControls } from './DiagramPathNodeControls';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  host?.remove();
  host = null;
});

const verb = (id: AnnotationActionId, label: string, extra: Partial<AnnotationAction> = {}): AnnotationAction => ({
  id,
  group: 'node',
  label,
  disabled: false,
  run: vi.fn(),
  ...extra,
});

function show(actions: AnnotationAction[], node: number | null, count: number) {
  host ??= document.body.appendChild(document.createElement('div'));
  root ??= createRoot(host);
  act(() =>
    root!.render(
      <TooltipProvider>
        <DiagramPathNodeControls actions={actions} node={node} count={count} keyed={(action) => action.label} />
      </TooltipProvider>
    )
  );
}

const button = (name: string) => host!.querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`);

describe('DiagramPathNodeControls', () => {
  it('keeps the focus on Next Node when it reaches the last, refusing rather than disabled', () => {
    const next = verb('next-node', 'Next Node');
    show([verb('previous-node', 'Previous Node'), next], 2, 4);
    const pressed = button('Next Node')!;
    act(() => pressed.focus());
    act(() => pressed.click());
    expect(next.run).toHaveBeenCalledOnce();
    // At the last node: the same button, still focused, refusing.
    const atEnd = verb('next-node', 'Next Node', { disabled: true });
    show([verb('previous-node', 'Previous Node'), atEnd], 3, 4);
    const still = button('Next Node')!;
    expect(still).toBe(pressed);
    expect(document.activeElement).toBe(still);
    expect(still.getAttribute('aria-disabled')).toBe('true');
    act(() => still.click());
    expect(atEnd.run).not.toHaveBeenCalled();
  });

  it('makes no edit for the type the node has already', () => {
    const smooth = verb('smooth-node', 'Smooth', { active: true });
    const corner = verb('corner-node', 'Corner', { active: false });
    show([smooth, corner], 1, 3);
    const option = (label: string) =>
      [...host!.querySelectorAll<HTMLButtonElement>('button, [role="radio"]')].find((each) => each.textContent === label)!;
    act(() => option('Smooth').click());
    expect(smooth.run).not.toHaveBeenCalled();
    act(() => option('Corner').click());
    expect(corner.run).toHaveBeenCalledOnce();
  });
});
