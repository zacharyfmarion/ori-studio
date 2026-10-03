import { describe, expect, it, vi } from 'vitest';
import {
  DIAGRAM_OWN_ARROWS_ATTRIBUTE,
  focusOwnsArrowKeys,
  runDiagramCancel,
  runDiagramShortcut,
  type DiagramKeyState,
} from './diagramShortcuts';

const steps = ['a', 'b', 'c'];

function run(id: Parameters<typeof runDiagramShortcut>[0], state: Partial<DiagramKeyState>) {
  const actions = { select: vi.fn(), move: vi.fn(), open: vi.fn(), close: vi.fn() };
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

  it('goes on from the focused card when nothing is selected', () => {
    expect(run('diagram.nextStep', { focusedStepId: 'b' }).select).toHaveBeenCalledWith('c');
    expect(run('diagram.previousStep', { focusedStepId: 'b' }).select).toHaveBeenCalledWith('a');
    // The selection wins over focus when there is one.
    expect(run('diagram.nextStep', { selectedStepId: 'a', focusedStepId: 'c' }).select).toHaveBeenCalledWith('b');
  });

  it('jumps to the first and last step with Home and End', () => {
    expect(run('diagram.firstStep', { selectedStepId: 'c' }).select).toHaveBeenCalledWith('a');
    expect(run('diagram.lastStep', {}).select).toHaveBeenCalledWith('c');
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
    // A move is an edit: it acts on the selection, never on a card merely focused.
    expect(run('diagram.moveStepLater', { focusedStepId: 'a' }).move).not.toHaveBeenCalled();
  });

  it('declines everything when there are no steps', () => {
    const actions = { select: vi.fn(), move: vi.fn(), open: vi.fn(), close: vi.fn() };
    const empty = { stepIds: [], selectedStepId: null, readOnly: false };
    for (const id of [
      'diagram.previousStep',
      'diagram.nextStep',
      'diagram.firstStep',
      'diagram.lastStep',
      'diagram.openStep',
      'diagram.moveStepEarlier',
      'diagram.moveStepLater',
    ] as const) {
      expect(runDiagramShortcut(id, empty, actions), id).toBe(false);
    }
  });
});

describe('Enter', () => {
  it('opens the selected step, or the focused one, in detail', () => {
    expect(run('diagram.openStep', { selectedStepId: 'b' }).open).toHaveBeenCalledWith('b');
    expect(run('diagram.openStep', { focusedStepId: 'c' }).open).toHaveBeenCalledWith('c');
  });

  it('declines with nothing to open, and inside the detail', () => {
    expect(run('diagram.openStep', {}).claimed).toBe(false);
    const inside = run('diagram.openStep', { selectedStepId: 'b', detailOpen: true });
    expect(inside.claimed).toBe(false);
    expect(inside.open).not.toHaveBeenCalled();
  });
});

describe('the Diagram’s Escape ladder', () => {
  it('leaves the detail, then deselects the step, then declines', () => {
    const select = vi.fn();
    const close = vi.fn();
    expect(runDiagramCancel({ selectedStepId: 'b', detailOpen: true }, { select, close })).toBe(true);
    expect(close).toHaveBeenCalledOnce();
    expect(select).not.toHaveBeenCalled();
    expect(runDiagramCancel({ selectedStepId: 'b' }, { select, close })).toBe(true);
    expect(select).toHaveBeenCalledWith(null);
    expect(runDiagramCancel({ selectedStepId: null }, { select, close })).toBe(false);
  });
});

describe('Annotate’s keys', () => {
  const annotate = (tool: string | null = null, selectedIsArrow = false) => ({
    annotate: { tool: tool as never, selectedAnnotationId: selectedIsArrow ? 'a' : null, selectedIsArrow },
  });
  const press = (id: Parameters<typeof runDiagramShortcut>[0], state: Partial<DiagramKeyState>) => {
    const actions = { select: vi.fn(), move: vi.fn(), open: vi.fn(), close: vi.fn(), setTool: vi.fn(), flipArc: vi.fn() };
    const claimed = runDiagramShortcut(id, { stepIds: steps, selectedStepId: 'a', readOnly: false, ...state }, actions);
    return { claimed, ...actions };
  };

  it('picks a tool by its letter, and puts it down with the same letter', () => {
    expect(press('diagram.toolValleyArrow', annotate()).setTool).toHaveBeenCalledWith('valley-arrow');
    expect(press('diagram.toolValleyLine', annotate()).setTool).toHaveBeenCalledWith('valley-line');
    expect(press('diagram.toolValleyArrow', annotate('valley-arrow')).setTool).toHaveBeenCalledWith(null);
  });

  it('flips only a selected fold arrow', () => {
    expect(press('diagram.flipArc', annotate(null, true))).toMatchObject({ claimed: true });
    expect(press('diagram.flipArc', annotate(null, false))).toMatchObject({ claimed: false });
  });

  it('declines outside Annotate, and on a diagram that cannot change, so a crease-pattern letter is left alone', () => {
    const outside = press('diagram.toolRotate', { annotate: null });
    expect(outside.claimed).toBe(false);
    expect(outside.setTool).not.toHaveBeenCalled();
    expect(press('diagram.toolRotate', { ...annotate(), readOnly: true }).claimed).toBe(false);
    // Even with no steps at all, the letters are Annotate's question, not the steps'.
    expect(press('diagram.toolRotate', { ...annotate(), stepIds: [] }).setTool).toHaveBeenCalledWith('rotate');
  });
});

describe('Annotate’s Escape rungs', () => {
  it('drops a drag, then the annotation, then the tool, then leaves the detail', () => {
    const actions = {
      select: vi.fn(),
      close: vi.fn(),
      cancelGesture: vi.fn(() => true),
      selectAnnotation: vi.fn(),
      setTool: vi.fn(),
    };
    const state = {
      selectedStepId: 'a',
      detailOpen: true,
      annotate: { tool: 'label' as const, selectedAnnotationId: 'x', selectedIsArrow: false },
    };
    expect(runDiagramCancel(state, actions)).toBe(true);
    expect(actions.cancelGesture).toHaveBeenCalledOnce();
    expect(actions.selectAnnotation).not.toHaveBeenCalled();

    actions.cancelGesture.mockReturnValue(false);
    runDiagramCancel(state, actions);
    expect(actions.selectAnnotation).toHaveBeenCalledWith(null);

    runDiagramCancel({ ...state, annotate: { ...state.annotate, selectedAnnotationId: null } }, actions);
    expect(actions.setTool).toHaveBeenCalledWith(null);
    expect(actions.close).not.toHaveBeenCalled();

    runDiagramCancel({ ...state, annotate: { tool: null, selectedAnnotationId: null, selectedIsArrow: false } }, actions);
    expect(actions.close).toHaveBeenCalledOnce();
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

  it('leaves the arrows to tab strips, radio groups and sliders, in a toolbar too', () => {
    expect(inside('<div role="tablist"><button id="x">Steps</button></div>', '#x')).toBe(true);
    expect(inside('<div role="radiogroup"><button id="x">A</button></div>', '#x')).toBe(true);
    expect(inside('<span role="slider" id="x"></span>', '#x')).toBe(true);
    expect(inside('<div role="toolbar"><span role="slider" id="x"></span></div>', '#x')).toBe(true);
  });

  it('leaves them to a list of the Diagram’s own that moves with them: the pattern picker', () => {
    expect(
      inside(`<div role="listbox" ${DIAGRAM_OWN_ARROWS_ATTRIBUTE}><button role="option" id="x"></button></div>`, '#x')
    ).toBe(true);
  });

  it('takes them from a plain button, in a toolbar or not, a step card, or nothing', () => {
    expect(inside('<button id="x">Add step</button>', '#x')).toBe(false);
    // The pose toolbar's Rotate: the next step must still be a key away.
    expect(inside('<div role="toolbar"><button id="x">Rotate</button></div>', '#x')).toBe(false);
    expect(inside('<div role="listbox"><div role="option" id="x"></div></div>', '#x')).toBe(false);
    expect(focusOwnsArrowKeys(null)).toBe(false);
  });
});
