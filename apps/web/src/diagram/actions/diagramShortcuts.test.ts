import { describe, expect, it, vi } from 'vitest';
import {
  focusOwnsArrowKeys,
  runDiagramCancel,
  runDiagramShortcut,
  type DiagramKeyState,
} from './diagramShortcuts';

const steps = ['a', 'b', 'c'];

function run(id: Parameters<typeof runDiagramShortcut>[0], state: Partial<DiagramKeyState>) {
  const actions = { select: vi.fn(), move: vi.fn() };
  const claimed = runDiagramShortcut(
    id,
    { stepIds: steps, selectedStepId: null, readOnly: false, ...state },
    actions
  );
  return { claimed, ...actions };
}

describe('the Diagram’s step keys', () => {
  it('walks the steps with the arrows, stopping at the ends', () => {
    expect(run('diagram.nextStep', { selectedStepId: 'a' }).select).toHaveBeenCalledWith('b');
    expect(run('diagram.previousStep', { selectedStepId: 'b' }).select).toHaveBeenCalledWith('a');
    expect(run('diagram.previousStep', { selectedStepId: 'a' }).select).toHaveBeenCalledWith('a');
    expect(run('diagram.nextStep', { selectedStepId: 'c' }).select).toHaveBeenCalledWith('c');
  });

  it('enters from either end when nothing is selected', () => {
    expect(run('diagram.nextStep', {}).select).toHaveBeenCalledWith('a');
    expect(run('diagram.previousStep', {}).select).toHaveBeenCalledWith('c');
  });

  it('claims at the ends too, so the page does not scroll under the grid', () => {
    expect(run('diagram.nextStep', { selectedStepId: 'c' }).claimed).toBe(true);
  });

  it('moves the selected step one place with Alt, and never off the ends', () => {
    expect(run('diagram.moveStepLater', { selectedStepId: 'a' }).move).toHaveBeenCalledWith('a', 1);
    expect(run('diagram.moveStepEarlier', { selectedStepId: 'c' }).move).toHaveBeenCalledWith('c', 1);
    const atStart = run('diagram.moveStepEarlier', { selectedStepId: 'a' });
    expect(atStart.move).not.toHaveBeenCalled();
    // Still claimed: Alt+← is the browser's Back.
    expect(atStart.claimed).toBe(true);
  });

  it('moves nothing on a read-only diagram or with nothing selected', () => {
    expect(run('diagram.moveStepLater', { selectedStepId: 'a', readOnly: true }).move).not.toHaveBeenCalled();
    expect(run('diagram.moveStepLater', {}).move).not.toHaveBeenCalled();
  });

  it('declines everything when there are no steps', () => {
    const actions = { select: vi.fn(), move: vi.fn() };
    const empty = { stepIds: [], selectedStepId: null, readOnly: false };
    for (const id of [
      'diagram.previousStep',
      'diagram.nextStep',
      'diagram.moveStepEarlier',
      'diagram.moveStepLater',
    ] as const) {
      expect(runDiagramShortcut(id, empty, actions), id).toBe(false);
    }
  });
});

describe('the Diagram’s Escape ladder', () => {
  it('deselects the step, then declines', () => {
    const select = vi.fn();
    expect(runDiagramCancel({ selectedStepId: 'b' }, { select })).toBe(true);
    expect(select).toHaveBeenCalledWith(null);
    expect(runDiagramCancel({ selectedStepId: null }, { select })).toBe(false);
  });
});

describe('focusOwnsArrowKeys', () => {
  function inside(markup: string, selector: string) {
    const host = document.createElement('div');
    host.innerHTML = markup;
    document.body.append(host);
    const element = host.querySelector(selector);
    const owns = focusOwnsArrowKeys(element);
    host.remove();
    return owns;
  }

  it('leaves the arrows to tab strips, radio groups, toolbars, menus and fields', () => {
    expect(inside('<div role="tablist"><button id="x">Steps</button></div>', '#x')).toBe(true);
    expect(inside('<div role="radiogroup"><button id="x">A</button></div>', '#x')).toBe(true);
    expect(inside('<div role="toolbar"><button id="x">A</button></div>', '#x')).toBe(true);
    expect(inside('<input id="x" />', '#x')).toBe(true);
  });

  it('takes them from a plain button, a step card, or nothing', () => {
    expect(inside('<button id="x">Add step</button>', '#x')).toBe(false);
    expect(inside('<div role="listbox"><div role="option" id="x"></div></div>', '#x')).toBe(false);
    expect(focusOwnsArrowKeys(null)).toBe(false);
  });
});
