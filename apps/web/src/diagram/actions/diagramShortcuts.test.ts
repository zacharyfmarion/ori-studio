import { describe, expect, it, vi } from 'vitest';
import { SHORTCUT_DEFINITIONS } from '../../keyboard/shortcuts';
import { NUDGE_STEP } from '../annotate/annotationActions';
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

  it('closes the References browser first, before the step it was opened beside', () => {
    const select = vi.fn();
    const close = vi.fn();
    const closeBrowser = vi.fn();
    expect(runDiagramCancel({ selectedStepId: 'b', browserOpen: true }, { select, close, closeBrowser })).toBe(true);
    expect(closeBrowser).toHaveBeenCalledOnce();
    expect(select).not.toHaveBeenCalled();
  });
});

describe('the step keys while the References browser is open', () => {
  // A modal with keys of its own: a key that reaches the Diagram has slipped
  // out of it, and acts on no step behind it.
  it('act on no step, and claim Alt+arrows so the browser’s Back never takes them', () => {
    for (const id of ['diagram.previousStep', 'diagram.nextStep', 'diagram.firstStep', 'diagram.lastStep', 'diagram.openStep'] as const) {
      const { claimed, select, open } = run(id, { selectedStepId: 'b', browserOpen: true });
      expect(claimed).toBe(false);
      expect(select).not.toHaveBeenCalled();
      expect(open).not.toHaveBeenCalled();
    }
    const moved = run('diagram.moveStepLater', { selectedStepId: 'b', browserOpen: true });
    expect(moved.claimed).toBe(true);
    expect(moved.move).not.toHaveBeenCalled();
  });
});

describe('Annotate’s keys', () => {
  const annotate = (tool: string | null = null, canFlipArc = false, lineType: 'valley' | 'mountain' | 'hidden' | 'solid' = 'valley') => ({
    annotate: { tool: tool as never, lineType, selectedAnnotationId: canFlipArc ? 'a' : null, canFlipArc },
  });
  const press = (id: Parameters<typeof runDiagramShortcut>[0], state: Partial<DiagramKeyState>) => {
    const actions = {
      select: vi.fn(),
      move: vi.fn(),
      open: vi.fn(),
      close: vi.fn(),
      setTool: vi.fn(),
      setLineType: vi.fn(),
      flipArc: vi.fn(),
    };
    const claimed = runDiagramShortcut(id, { stepIds: steps, selectedStepId: 'a', readOnly: false, ...state }, actions);
    return { claimed, ...actions };
  };

  it('picks Enlarge with E and Enlarge in Frame with Shift+E, and neither on an enlarged step (Revision 2)', () => {
    expect(press('diagram.toolEnlarge', annotate()).setTool).toHaveBeenCalledWith('enlarge');
    expect(press('diagram.toolEnlargeFrame', annotate()).setTool).toHaveBeenCalledWith('enlarge-frame');
    const enlarged = { annotate: { ...annotate().annotate, enlarged: true } };
    const held = press('diagram.toolEnlarge', enlarged);
    // Claimed, so the letter does nothing else, and nothing picked.
    expect(held.claimed).toBe(true);
    expect(held.setTool).not.toHaveBeenCalled();
    // One already in hand from another step still goes down with its letter.
    expect(press('diagram.toolEnlarge', { annotate: { ...enlarged.annotate, tool: 'enlarge' as never } }).setTool).toHaveBeenCalledWith(null);
  });

  it('picks a tool by its letter, and puts it down with the same letter', () => {
    expect(press('diagram.toolValleyArrow', annotate()).setTool).toHaveBeenCalledWith('valley-arrow');
    expect(press('diagram.toolValleyArrow', annotate('valley-arrow')).setTool).toHaveBeenCalledWith(null);
    expect(press('diagram.toolCircle', annotate())).toMatchObject({ claimed: true });
    expect(press('diagram.toolCircle', annotate()).setTool).toHaveBeenCalledWith('circle');
  });

  it('picks a line type with Shift+V, Shift+M or H, and the Line tool with it; its own type again puts it down (15a)', () => {
    // From another tool: the type, and Line.
    const fromArrow = press('diagram.toolMountainLine', annotate('valley-arrow'));
    expect(fromArrow.claimed).toBe(true);
    expect(fromArrow.setLineType).toHaveBeenCalledWith('mountain');
    expect(fromArrow.setTool).toHaveBeenCalledWith('line');
    // Line in hand: the type alone.
    const switched = press('diagram.toolHiddenLine', annotate('line'));
    expect(switched.setLineType).toHaveBeenCalledWith('hidden');
    expect(switched.setTool).not.toHaveBeenCalled();
    // Line in hand, its own type: back to Select, as a tool's letter does.
    const again = press('diagram.toolValleyLine', annotate('line', false, 'valley'));
    expect(again.setTool).toHaveBeenCalledWith(null);
    expect(again.setLineType).not.toHaveBeenCalled();
    // Outside Annotate it declines: the keys are a crease-pattern tool's too.
    expect(press('diagram.toolValleyLine', {}).claimed).toBe(false);
  });

  it('picks Solid with Shift+L, a chord no other Diagram key or the view’s has, as Shift+V and Shift+M pick theirs (17a)', () => {
    const solid = SHORTCUT_DEFINITIONS.find((shortcut) => shortcut.id === 'diagram.toolSolidLine');
    expect(solid).toMatchObject({ scope: 'diagram', defaultChord: { shift: true, key: 'l' } });
    const others = SHORTCUT_DEFINITIONS.filter(
      (shortcut) =>
        shortcut.id !== 'diagram.toolSolidLine' &&
        ['diagram', 'diagram-path', 'viewport', 'global'].includes(shortcut.scope) &&
        shortcut.defaultChords.some((chord) => chord.key === 'l' && chord.shift && !chord.primary && !chord.alt)
    );
    expect(others).toEqual([]);
    const picked = press('diagram.toolSolidLine', annotate('valley-arrow'));
    expect(picked.setLineType).toHaveBeenCalledWith('solid');
    expect(picked.setTool).toHaveBeenCalledWith('line');
    expect(press('diagram.toolSolidLine', annotate('line', false, 'solid')).setTool).toHaveBeenCalledWith(null);
  });

  it('binds the circle to O, a letter no other Diagram key or the view’s has', () => {
    const circle = SHORTCUT_DEFINITIONS.find((shortcut) => shortcut.id === 'diagram.toolCircle');
    expect(circle).toMatchObject({ scope: 'diagram', defaultChord: { key: 'o' } });
    const others = SHORTCUT_DEFINITIONS.filter(
      (shortcut) =>
        shortcut.id !== 'diagram.toolCircle' &&
        ['diagram', 'diagram-path', 'viewport', 'global'].includes(shortcut.scope) &&
        shortcut.defaultChords.some((chord) => chord.key === 'o' && !chord.primary && !chord.shift && !chord.alt)
    );
    expect(others).toEqual([]);
  });

  it('binds the right angle to Q, a letter no other Diagram key or the view’s has, and picks it in Annotate', () => {
    const square = SHORTCUT_DEFINITIONS.find((shortcut) => shortcut.id === 'diagram.toolRightAngle');
    expect(square).toMatchObject({ scope: 'diagram', defaultChord: { key: 'q' } });
    const others = SHORTCUT_DEFINITIONS.filter(
      (shortcut) =>
        shortcut.id !== 'diagram.toolRightAngle' &&
        ['diagram', 'diagram-path', 'viewport', 'global'].includes(shortcut.scope) &&
        shortcut.defaultChords.some((chord) => chord.key === 'q' && !chord.primary && !chord.shift && !chord.alt)
    );
    expect(others).toEqual([]);
    expect(press('diagram.toolRightAngle', annotate()).setTool).toHaveBeenCalledWith('right-angle');
    expect(press('diagram.toolRightAngle', annotate('right-angle')).setTool).toHaveBeenCalledWith(null);
  });

  it('binds the white arrow to W, a letter no other Diagram key or the view’s has, and picks it', () => {
    const white = SHORTCUT_DEFINITIONS.find((shortcut) => shortcut.id === 'diagram.toolWhiteArrow');
    expect(white).toMatchObject({ scope: 'diagram', defaultChord: { key: 'w' } });
    const others = SHORTCUT_DEFINITIONS.filter(
      (shortcut) =>
        shortcut.id !== 'diagram.toolWhiteArrow' &&
        ['diagram', 'diagram-path', 'viewport', 'global'].includes(shortcut.scope) &&
        shortcut.defaultChords.some((chord) => chord.key === 'w' && !chord.primary && !chord.shift && !chord.alt)
    );
    expect(others).toEqual([]);
    expect(press('diagram.toolWhiteArrow', annotate()).setTool).toHaveBeenCalledWith('white-arrow');
    expect(press('diagram.toolWhiteArrow', annotate('white-arrow')).setTool).toHaveBeenCalledWith(null);
    // Outside Annotate it is no key of the Diagram's.
    expect(press('diagram.toolWhiteArrow', {})).toMatchObject({ claimed: false });
  });

  it('binds the callout to C, a letter no other Diagram key or the view’s has, and picks it with it', () => {
    const callout = SHORTCUT_DEFINITIONS.find((shortcut) => shortcut.id === 'diagram.toolCallout');
    expect(callout).toMatchObject({ scope: 'diagram', defaultChord: { key: 'c' } });
    const others = SHORTCUT_DEFINITIONS.filter(
      (shortcut) =>
        shortcut.id !== 'diagram.toolCallout' &&
        ['diagram', 'diagram-path', 'viewport', 'global'].includes(shortcut.scope) &&
        shortcut.defaultChords.some((chord) => chord.key === 'c' && !chord.primary && !chord.shift && !chord.alt)
    );
    expect(others).toEqual([]);
    expect(press('diagram.toolCallout', annotate())).toMatchObject({ claimed: true });
    expect(press('diagram.toolCallout', annotate()).setTool).toHaveBeenCalledWith('callout');
    expect(press('diagram.toolCallout', annotate('callout')).setTool).toHaveBeenCalledWith(null);
  });

  it.each([
    ['the pleat arrow', 'diagram.toolPleatArrow', 'z', 'pleat-arrow'],
    ['the angle bisector', 'diagram.toolAngleBisector', 'b', 'angle-bisector'],
    ['the solid arrow', 'diagram.toolSolidArrow', 's', 'solid-arrow'],
    ['equal divisions', 'diagram.toolDivisions', 'd', 'divisions'],
  ] as const)('binds %s to its letter, which no other Diagram key or the view’s has, and picks it (15b–15d, Revision 2)', (_name, id, key, tool) => {
    expect(SHORTCUT_DEFINITIONS.find((shortcut) => shortcut.id === id)).toMatchObject({ scope: 'diagram', defaultChord: { key } });
    const others = SHORTCUT_DEFINITIONS.filter(
      (shortcut) =>
        shortcut.id !== id &&
        ['diagram', 'diagram-path', 'viewport', 'global'].includes(shortcut.scope) &&
        shortcut.defaultChords.some((chord) => chord.key === key && !chord.primary && !chord.shift && !chord.alt)
    );
    expect(others).toEqual([]);
    expect(press(id, annotate()).setTool).toHaveBeenCalledWith(tool);
    expect(press(id, annotate(tool)).setTool).toHaveBeenCalledWith(null);
    expect(press(id, {})).toMatchObject({ claimed: false });
  });

  it('flips only a selected fold arrow', () => {
    expect(press('diagram.flipArc', annotate(null, true))).toMatchObject({ claimed: true });
    expect(press('diagram.flipArc', annotate(null, false))).toMatchObject({ claimed: false });
  });

  it('declines outside Annotate, and on a diagram that cannot change, so a crease-pattern letter is left alone', () => {
    const outside = press('diagram.toolCircle', { annotate: null });
    expect(outside.claimed).toBe(false);
    expect(outside.setTool).not.toHaveBeenCalled();
    expect(press('diagram.toolCircle', { ...annotate(), readOnly: true }).claimed).toBe(false);
    // Even with no steps at all, the letters are Annotate's question, not the steps'.
    expect(press('diagram.toolCircle', { ...annotate(), stepIds: [] }).setTool).toHaveBeenCalledWith('circle');
  });
});

describe('Annotate’s Escape rungs', () => {
  it('leaves the anchor’s pick mode first, wherever the focus is (Revision 2)', () => {
    const actions = { select: vi.fn(), close: vi.fn(), selectAnnotation: vi.fn(), setTool: vi.fn(), endAnchorPick: vi.fn() };
    const state = {
      selectedStepId: 'a',
      detailOpen: true,
      anchorPick: true,
      annotate: { tool: null, selectedAnnotationId: 'area', canFlipArc: false },
    };
    expect(runDiagramCancel(state, actions)).toBe(true);
    expect(actions.endAnchorPick).toHaveBeenCalledOnce();
    expect(actions.selectAnnotation).not.toHaveBeenCalled();
    // Then the area, as any selection.
    runDiagramCancel({ ...state, anchorPick: false }, actions);
    expect(actions.selectAnnotation).toHaveBeenCalledWith(null);
  });

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
      annotate: { tool: 'label' as const, selectedAnnotationId: 'x', canFlipArc: false },
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

    runDiagramCancel({ ...state, annotate: { tool: null, selectedAnnotationId: null, canFlipArc: false } }, actions);
    expect(actions.close).toHaveBeenCalledOnce();
  });

  it('in Edit Path, drops a drag, then the node, then puts Edit Path down with the arrow still selected', () => {
    const actions = {
      select: vi.fn(),
      close: vi.fn(),
      cancelGesture: vi.fn(() => true),
      selectAnnotation: vi.fn(),
      selectPathNode: vi.fn(),
      setTool: vi.fn(),
    };
    const editPath = { tool: 'edit-path' as const, selectedAnnotationId: 'x', canFlipArc: true, selectedPathNode: 2 };
    const state = { selectedStepId: 'a', detailOpen: true, annotate: editPath };
    runDiagramCancel(state, actions);
    expect(actions.selectPathNode).not.toHaveBeenCalled();

    actions.cancelGesture.mockReturnValue(false);
    expect(runDiagramCancel(state, actions)).toBe(true);
    expect(actions.selectPathNode).toHaveBeenCalledWith(null);
    expect(actions.setTool).not.toHaveBeenCalled();

    expect(runDiagramCancel({ ...state, annotate: { ...editPath, selectedPathNode: null } }, actions)).toBe(true);
    expect(actions.setTool).toHaveBeenCalledWith(null);
    expect(actions.selectAnnotation).not.toHaveBeenCalled();

    // Back to Select: the rest of the ladder, as ever.
    runDiagramCancel({ ...state, annotate: { ...editPath, tool: null, selectedPathNode: null } }, actions);
    expect(actions.selectAnnotation).toHaveBeenCalledWith(null);
    expect(actions.close).not.toHaveBeenCalled();
  });
});

describe('Edit Path’s keys', () => {
  const editPath = (selectedPathNode: number | null, tool: string | null = 'edit-path') => ({
    annotate: { tool: tool as never, selectedAnnotationId: 'x', canFlipArc: true, selectedPathNode },
  });
  const press = (id: Parameters<typeof runDiagramShortcut>[0], state: Partial<DiagramKeyState>) => {
    const actions = {
      select: vi.fn(),
      move: vi.fn(),
      open: vi.fn(),
      close: vi.fn(),
      setTool: vi.fn(),
      nudgePathNode: vi.fn(),
    };
    const claimed = runDiagramShortcut(id, { stepIds: steps, selectedStepId: 'a', readOnly: false, ...state }, actions);
    return { claimed, ...actions };
  };

  it('picks Edit Path with A, and puts it down with A', () => {
    expect(press('diagram.toolEditPath', editPath(null, null)).setTool).toHaveBeenCalledWith('edit-path');
    expect(press('diagram.toolEditPath', editPath(null)).setTool).toHaveBeenCalledWith(null);
  });

  it('nudges the selected node with the arrows, ten times as far with Shift', () => {
    expect(press('diagram.nudgeNodeLeft', editPath(1)).nudgePathNode).toHaveBeenCalledWith([-NUDGE_STEP.small, 0]);
    expect(press('diagram.nudgeNodeDown', editPath(1)).nudgePathNode).toHaveBeenCalledWith([0, NUDGE_STEP.small]);
    expect(press('diagram.nudgeNodeUpLarge', editPath(0)).nudgePathNode).toHaveBeenCalledWith([0, -NUDGE_STEP.large]);
    expect(press('diagram.nudgeNodeRightLarge', editPath(0))).toMatchObject({ claimed: true });
  });

  it('declines the arrows with no node selected, another tool, outside Annotate or read-only, so they walk the steps', () => {
    for (const state of [editPath(null), editPath(1, null), { annotate: null }, { ...editPath(1), readOnly: true }]) {
      const { claimed, nudgePathNode, select } = press('diagram.nudgeNodeRight', state);
      expect(claimed).toBe(false);
      expect(nudgePathNode).not.toHaveBeenCalled();
      expect(select).not.toHaveBeenCalled();
    }
    // The step keys themselves are untouched by Edit Path.
    expect(press('diagram.nextStep', editPath(1)).select).toHaveBeenCalledWith('b');
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
