import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDiagram, type KnownDiagramAnnotation } from '../../diagram/document/diagramDocument';
import { cpStep, referencesStep, stepsIn } from '../../diagram/document/diagramSteps.fixtures';
import { ANNOTATE_TOOL_GROUPS, annotateToolHelp } from '../../diagram/annotate/annotateTools';
import { angleMarkAt } from '../../diagram/annotate/annotationModel';
import i18n from '../../i18n';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { TooltipProvider } from '../ui/Tooltip';
import { DiagramLayersPanel } from './DiagramLayersPanel';

const tracked = vi.hoisted(() => ({
  trackDiagramAnnotationBehind: vi.fn(),
  trackDiagramAnnotationRecolored: vi.fn(),
  trackDiagramTextStyled: vi.fn(),
  trackDiagramReferencesMarksLifted: vi.fn(),
}));
vi.mock('../../analytics', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../analytics')>()),
  trackDiagramAnnotationBehind: tracked.trackDiagramAnnotationBehind,
  trackDiagramAnnotationRecolored: tracked.trackDiagramAnnotationRecolored,
  trackDiagramTextStyled: tracked.trackDiagramTextStyled,
  trackDiagramReferencesMarksLifted: tracked.trackDiagramReferencesMarksLifted,
}));

/**
 * The Layers pane through the store (Zach, 2026-10-05): what is drawn on the
 * step open in Annotate — a press on a row selects it — and the selected
 * one's controls, each one undo step; out of Annotate, one line.
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
        <DiagramLayersPanel />
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
const button = (label: string) =>
  host?.querySelector(`button[aria-label="${label}"]`) as HTMLButtonElement | null;

function setField(field: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const prototype = field instanceof HTMLTextAreaElement ? HTMLTextAreaElement : HTMLInputElement;
  act(() => {
    Object.getOwnPropertyDescriptor(prototype.prototype, 'value')!.set!.call(field, value);
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

describe('DiagramLayersPanel', () => {
  /** A step with a picture, open in Annotate, carrying a label and an arrow. */
  function annotatedStep() {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="30" viewBox="0 0 40 30"/>';
    act(() => {
      state().addDiagramPictures([{ id: 'asset-1', kind: 'svg', svg, widthPx: 40, heightPx: 30, bytes: svg.length }]);
    });
    const stepId = state().diagramSelectedStepId!;
    act(() => {
      state().editDiagramAnnotations(stepId, 'Add annotation', () => [
        { id: 'a-1', kind: 'valley-arrow', from: [0.1, 0.2], to: [0.5, 0.2], bend: 0.1 },
        { id: 'a-2', kind: 'label', from: [0.5, 0.5], to: [0.5, 0.5], text: 'B' },
        { id: 'a-3', kind: 'rotate', from: [0.8, 0.8], to: [0.8, 0.8], rotate: { amount: 'quarter', direction: 'cw' } },
      ]);
    });
    return stepId;
  }
  const annotations = () => stepsIn(state().diagram!)[0]!.annotations as { id: string; bend?: number; text?: string; rotate?: unknown }[];
  const row = (name: string) =>
    [...(host?.querySelectorAll<HTMLButtonElement>('ul button') ?? [])].find((candidate) => candidate.textContent === name)!;
  const buttonNamed = (name: string) =>
    [...(host?.querySelectorAll<HTMLButtonElement>('button') ?? [])].find((candidate) => candidate.textContent?.trim() === name)!;

  it('says, out of Annotate, where its layers are; in Annotate with nothing drawn, so', () => {
    const stepId = annotatedStep();
    expect(host?.textContent).toBe('Open a step in Annotate to see its layers.');
    act(() => {
      state().editDiagramAnnotations(stepId, 'Delete annotations', () => []);
      state().openDiagramStep(stepId, 'annotate');
    });
    expect(host?.textContent).toBe('Nothing drawn yet.');
    act(() => state().closeDiagramStep());
    expect(host?.textContent).toBe('Open a step in Annotate to see its layers.');
  });

  it('says over the list when a References step’s marks are part of its picture, and makes them editable on a press (17e)', () => {
    act(() => {
      useWorkspaceStore.setState({ diagram: { ...createDiagram({ newId: () => 'diagram-1' }), steps: [referencesStep('step-r')] } });
      state().openDiagramStep('step-r', 'annotate');
    });
    // The list cannot show what the picture holds: the notice says it is there.
    expect(host?.textContent).toContain('This step’s marks are part of its picture.');
    expect(host?.textContent).toContain('Nothing drawn yet.');
    const past = state().diagramHistory.past.length;
    act(() => buttonNamed('Make Editable').click());
    expect(state().diagramHistory.past).toHaveLength(past + 1);
    expect(tracked.trackDiagramReferencesMarksLifted).toHaveBeenCalledExactlyOnceWith('layers_notice', 3);
    expect(host?.textContent).not.toContain('part of its picture');
    expect(host?.querySelectorAll('ul[aria-label="Layers"] li')).toHaveLength(3);
  });

  it('lists them, selects one with a press, and offers its own controls', () => {
    const stepId = annotatedStep();
    act(() => state().openDiagramStep(stepId, 'annotate'));
    // A row pressed with a drawing tool in hand puts Select back, to move what it selected.
    act(() => state().setDiagramAnnotateTool('line'));
    act(() => row('Valley Fold Arrow').click());
    expect(state().diagramSelectedAnnotationId).toBe('a-1');
    expect(state().diagramAnnotateTool).toBeNull();
    expect(row('Valley Fold Arrow').getAttribute('aria-pressed')).toBe('true');
    act(() => buttonNamed('Flip Arc').click());
    expect(annotations()[0]!.bend).toBe(-0.1);
    act(() => row('Rotate').click());
    act(() => buttonNamed('1/2').click());
    expect(annotations()[2]!.rotate).toEqual({ amount: 'half', direction: 'cw' });
    act(() => buttonNamed('Delete').click());
    expect(annotations().map((annotation) => annotation.id)).toEqual(['a-1', 'a-2']);
    expect(state().diagramSelectedAnnotationId).toBeNull();
  });

  it('makes a selected line another type with Type, the same line, as one undo step (15a)', () => {
    const stepId = annotatedStep();
    act(() => {
      state().editDiagramAnnotations(stepId, 'Add annotation', (list) => [
        ...list,
        { id: 'l-1', kind: 'valley-line', from: [0.1, 0.6], to: [0.7, 0.6] },
      ]);
      state().openDiagramStep(stepId, 'annotate');
    });
    act(() => row('Valley Line').click());
    const type = () => host!.querySelector('[role="group"][aria-label="Type"]')!;
    const option = (name: string) => [...type().querySelectorAll<HTMLButtonElement>('button')].find((button) => button.getAttribute('aria-label') === name)!;
    expect(option('Valley').getAttribute('aria-pressed')).toBe('true');
    const past = state().diagramHistory.past.length;
    act(() => option('Mountain').click());
    expect(annotations().find((annotation) => annotation.id === 'l-1')).toEqual({
      id: 'l-1',
      kind: 'mountain-line',
      from: [0.1, 0.6],
      to: [0.7, 0.6],
    });
    expect(state().diagramHistory.past).toHaveLength(past + 1);
    expect(state().diagramHistory.past.at(-1)?.label).toBe('Change line type');
    // Not a line: no Type.
    act(() => row('Valley Fold Arrow').click());
    expect(host!.querySelector('[role="group"][aria-label="Type"]')).toBeNull();
  });

  it('recolours a selected solid line with Color, one undo step and one count a pick, and a type change drops it (17a)', () => {
    // What Radix's select asks of the DOM, which jsdom does not have.
    Element.prototype.hasPointerCapture ??= () => false;
    Element.prototype.releasePointerCapture ??= () => undefined;
    Element.prototype.scrollIntoView ??= () => undefined;
    tracked.trackDiagramAnnotationRecolored.mockClear();
    const stepId = annotatedStep();
    act(() => {
      state().editDiagramAnnotations(stepId, 'Add annotation', (list) => [
        ...list,
        { id: 's-1', kind: 'solid-line', from: [0.1, 0.6], to: [0.7, 0.6], color: '#1971c2' },
      ]);
      state().openDiagramStep(stepId, 'annotate');
    });
    act(() => row('Solid Line').click());
    const color = () => host!.querySelector<HTMLButtonElement>('button[aria-label="Color"]')!;
    const solid = () => stepsIn(state().diagram!)[0]!.annotations.find((annotation) => annotation.id === 's-1') as KnownDiagramAnnotation;
    expect(color().textContent).toBe('Blue');
    const choose = (name: string) => {
      act(() => color().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
      const option = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find((each) => each.textContent === name)!;
      act(() => option.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
    };
    const past = state().diagramHistory.past.length;
    choose('Red');
    expect(solid().color).toBe('#e03131');
    expect(state().diagramHistory.past).toHaveLength(past + 1);
    expect(state().diagramHistory.past.at(-1)?.label).toBe('Change color');
    expect(tracked.trackDiagramAnnotationRecolored.mock.calls).toEqual([['solid_line', 'red']]);
    // Custom…: the engine's picker, every colour it moves through one step and one count.
    const picker = host!.querySelector<HTMLInputElement>('input[type="color"]')!;
    picker.showPicker = () => undefined;
    choose('Custom…');
    act(() => vi.advanceTimersByTime(50));
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    for (const value of ['#102030', '#405060']) {
      act(() => {
        setter.call(picker, value);
        picker.dispatchEvent(new Event('input', { bubbles: true }));
      });
    }
    expect(solid().color).toBe('#405060');
    expect(state().diagramHistory.past).toHaveLength(past + 2);
    expect(tracked.trackDiagramAnnotationRecolored.mock.calls).toEqual([
      ['solid_line', 'red'],
      ['solid_line', 'custom'],
    ]);
    expect(color().textContent).toBe('#405060');
    choose('Ink');
    expect(solid()).not.toHaveProperty('color');
    choose('Purple');
    // Made a valley line, it loses its colour; and a valley line has no Color.
    const type = host!.querySelector('[role="group"][aria-label="Type"]')!;
    act(() => [...type.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.getAttribute('aria-label') === 'Valley')!.click());
    expect(solid()).toEqual({ id: 's-1', kind: 'valley-line', from: [0.1, 0.6], to: [0.7, 0.6] });
    expect(host!.querySelector('button[aria-label="Color"]')).toBeNull();
  });

  it('styles a selected label with Color, Bold, Halo and Size, each one undo step and counted; a callout has none of them (17b)', () => {
    Element.prototype.hasPointerCapture ??= () => false;
    Element.prototype.releasePointerCapture ??= () => undefined;
    Element.prototype.scrollIntoView ??= () => undefined;
    tracked.trackDiagramAnnotationRecolored.mockClear();
    tracked.trackDiagramTextStyled.mockClear();
    const stepId = annotatedStep();
    act(() => {
      state().editDiagramAnnotations(stepId, 'Add annotation', (list) => [
        ...list,
        { id: 'c-1', kind: 'callout', from: [0.1, 0.1], to: [0.3, 0.3], text: 'Repeat' },
      ]);
      state().openDiagramStep(stepId, 'annotate');
    });
    const label = () => stepsIn(state().diagram!)[0]!.annotations.find((annotation) => annotation.id === 'a-2') as KnownDiagramAnnotation;
    const field = (name: string) => host!.querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`);
    // A callout keeps its look: Text, but no colour, weight, halo or size.
    act(() => row('Repeat').click());
    expect(host!.querySelector('textarea')).not.toBeNull();
    for (const name of ['Color', 'Bold', 'Halo', 'Size']) expect(field(name), name).toBeNull();
    act(() => row('B').click());
    // Under its Text row: Color, Bold, Halo and Size, in that order.
    const labels = [...host!.querySelectorAll('[aria-label]')].map((each) => each.getAttribute('aria-label'));
    const order = ['Color', 'Bold', 'Halo', 'Size'].map((name) => labels.indexOf(name));
    expect(order.every((at, index) => at >= 0 && (index === 0 || at > order[index - 1]!))).toBe(true);
    expect(field('Color')!.textContent).toBe('Ink');
    expect(field('Size')!.textContent).toBe('With the picture');
    const choose = (select: string, name: string) => {
      act(() => field(select)!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
      const option = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find((each) => each.textContent === name)!;
      act(() => option.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
    };
    const past = state().diagramHistory.past.length;
    choose('Color', 'Reference');
    act(() => field('Bold')!.click());
    act(() => field('Halo')!.click());
    choose('Size', '9 pt');
    expect(label()).toMatchObject({ color: '#c91d87', bold: true, halo: true, sizePt: 9 });
    expect(state().diagramHistory.past.slice(past).map((entry) => entry.label)).toEqual([
      'Change color',
      'Change bold',
      'Change halo',
      'Change text size',
    ]);
    expect(tracked.trackDiagramAnnotationRecolored.mock.calls).toEqual([['label', 'reference']]);
    expect(tracked.trackDiagramTextStyled.mock.calls).toEqual([
      ['bold', 'on'],
      ['halo', 'on'],
      ['size', '9'],
    ]);
    // With the picture again, and Bold off: written as today's label is.
    choose('Size', 'With the picture');
    act(() => field('Bold')!.click());
    expect(label()).not.toHaveProperty('sizePt');
    expect(label()).not.toHaveProperty('bold');
    expect(tracked.trackDiagramTextStyled.mock.calls.slice(3)).toEqual([
      ['size', 'picture'],
      ['bold', 'off'],
    ]);
    // A size a file brought that Size does not offer shows as its own.
    act(() => {
      state().editDiagramAnnotations(stepId, 'Edit', (list) =>
        list.map((annotation) => (annotation.id === 'a-2' ? { ...annotation, sizePt: 10.5 } : annotation))
      );
    });
    expect(field('Size')!.textContent).toBe('10.5 pt');
  });

  it('draws each solid line’s row in its colour, one with none in the icon’s ink (17a)', () => {
    const stepId = annotatedStep();
    act(() => {
      state().editDiagramAnnotations(stepId, 'Add annotation', (list) => [
        ...list,
        { id: 's-a', kind: 'solid-line', from: [0.1, 0.6], to: [0.7, 0.6], color: '#e8590c' },
        { id: 's-b', kind: 'solid-line', from: [0.1, 0.8], to: [0.7, 0.8] },
      ]);
      state().openDiagramStep(stepId, 'annotate');
    });
    const strokes = [...host!.querySelectorAll<HTMLButtonElement>('ul button')]
      .filter((each) => each.textContent === 'Solid Line')
      .map((each) => each.querySelector('svg')!.getAttribute('stroke'));
    expect(strokes).toEqual(['#e8590c', 'currentColor']);
  });

  it('ends a pick with its line: a picker still up when another line is selected recolours neither it nor the undo step (17a)', () => {
    Element.prototype.hasPointerCapture ??= () => false;
    Element.prototype.releasePointerCapture ??= () => undefined;
    Element.prototype.scrollIntoView ??= () => undefined;
    const stepId = annotatedStep();
    act(() => {
      state().editDiagramAnnotations(stepId, 'Add annotation', (list) => [
        ...list,
        { id: 's-a', kind: 'solid-line', from: [0.1, 0.6], to: [0.7, 0.6], color: '#1971c2' },
        { id: 's-b', kind: 'solid-line', from: [0.1, 0.8], to: [0.7, 0.8], color: '#e03131' },
      ]);
      state().openDiagramStep(stepId, 'annotate');
      state().selectDiagramAnnotation('s-a');
    });
    const colorOf = (id: string) =>
      (stepsIn(state().diagram!)[0]!.annotations.find((annotation) => annotation.id === id) as KnownDiagramAnnotation).color;
    const color = () => host!.querySelector<HTMLButtonElement>('button[aria-label="Color"]')!;
    act(() => color().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
    const custom = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find((each) => each.textContent === 'Custom…')!;
    const picker = host!.querySelector<HTMLInputElement>('input[type="color"]')!;
    picker.showPicker = () => undefined;
    act(() => custom.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
    act(() => vi.advanceTimersByTime(50));
    const move = (value: string) =>
      act(() => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(picker, value);
        picker.dispatchEvent(new Event('input', { bubbles: true }));
      });
    const past = state().diagramHistory.past.length;
    move('#102030');
    expect(colorOf('s-a')).toBe('#102030');
    // Another line selected while the picker is up: the old select goes, and its picker with its input.
    act(() => state().selectDiagramAnnotation('s-b'));
    expect(picker.isConnected).toBe(false);
    move('#405060');
    expect(colorOf('s-b')).toBe('#e03131');
    expect(state().diagramHistory.past).toHaveLength(past + 1);
    act(() => state().undoDiagram());
    expect([colorOf('s-a'), colorOf('s-b')]).toEqual(['#1971c2', '#e03131']);
  });

  it('gives an equal-angle mark more ticks with Ticks, one when it says none, as one undo step (15b)', () => {
    const stepId = annotatedStep();
    const mark = angleMarkAt([0.5, 0.7], [0.4, 0.6], [0.5, 0.6])!;
    act(() => {
      state().editDiagramAnnotations(stepId, 'Add annotation', (list) => [
        ...list,
        { id: 'm-1', kind: 'angle-mark', ...mark },
      ]);
      state().openDiagramStep(stepId, 'annotate');
    });
    act(() => row('Equal Angles').click());
    const ticks = () => [...host!.querySelectorAll<HTMLButtonElement>('[role="group"][aria-label="Ticks"] button')];
    const tick = (count: string) => ticks().find((option) => option.textContent?.trim() === count)!;
    expect(ticks().map((option) => option.textContent?.trim())).toEqual(['1', '2', '3']);
    expect(tick('1').getAttribute('aria-pressed')).toBe('true');
    const past = state().diagramHistory.past.length;
    act(() => tick('2').click());
    expect(annotations().find((annotation) => annotation.id === 'm-1')).toEqual({ id: 'm-1', kind: 'angle-mark', ...mark, ticks: 2 });
    expect(state().diagramHistory.past).toHaveLength(past + 1);
    expect(state().diagramHistory.past.at(-1)?.label).toBe('Change angle mark');
    // Not an angle mark: no Ticks.
    act(() => row('Valley Fold Arrow').click());
    expect(ticks()).toEqual([]);
  });

  it('gives a pleat arrow more Zs with Kinks, one to five, and steps them to the other side with Flip, each one undo step (15c)', () => {
    const stepId = annotatedStep();
    act(() => {
      state().editDiagramAnnotations(stepId, 'Add annotation', (list) => [
        ...list,
        { id: 'p-1', kind: 'pleat-arrow', from: [0.6, 0.4], to: [0.2, 0.5] },
      ]);
      state().openDiagramStep(stepId, 'annotate');
    });
    act(() => row('Pleat Arrow').click());
    const pleat = () => annotations().find((annotation) => annotation.id === 'p-1') as Record<string, unknown>;
    const kinks = host!.querySelector<HTMLInputElement>('input[aria-label="Kinks"]')!;
    // One when it says none.
    expect(kinks.value).toBe('1');
    const past = state().diagramHistory.past.length;
    act(() => button('Increase Kinks')!.click());
    expect(pleat().kinks).toBe(2);
    expect(state().diagramHistory.past).toHaveLength(past + 1);
    expect(state().diagramHistory.past.at(-1)?.label).toBe('Change pleat arrow');
    // No fewer than one, no more than five.
    act(() => kinks.focus());
    setField(kinks, '9');
    act(() => kinks.blur());
    expect(pleat().kinks).toBe(5);
    // Flip, as it is named on a pleat arrow: its Zs to the other side, and back.
    expect(buttonNamed('Flip Arc')).toBeUndefined();
    act(() => buttonNamed('Flip').click());
    expect(pleat().mirrored).toBe(true);
    act(() => buttonNamed('Flip').click());
    expect('mirrored' in pleat()).toBe(false);
  });

  describe('equal divisions (Revision 2)', () => {
    function divided(more: Record<string, unknown> = {}) {
      const stepId = annotatedStep();
      act(() => {
        state().editDiagramAnnotations(stepId, 'Add annotation', (list) => [
          ...list,
          { id: 'd-1', kind: 'divisions', from: [0, 0], to: [1, 0], parts: 4, offset: 2.5, mirrored: true, ...more },
        ]);
        state().openDiagramStep(stepId, 'annotate');
      });
      return stepId;
    }
    const divisions = () => annotations().find((annotation) => annotation.id === 'd-1') as Record<string, unknown>;
    const input = (name: string) => host!.querySelector<HTMLInputElement>(`input[aria-label="${name}"]`)!;
    const number = () => host!.querySelector<HTMLButtonElement>('[role="switch"][aria-label="Number"]')!;
    const ticks = () => [...host!.querySelectorAll<HTMLButtonElement>('[role="group"][aria-label="Ticks"] button')];
    const last = () => state().diagramHistory.past.at(-1)?.label;

    it('sets their Parts, Offset, Ticks and Number in that order, and puts their line over with Flip, each one undo step', () => {
      divided();
      act(() => row('Equal Divisions').click());
      const parts = input('Parts');
      const offset = input('Offset');
      // Parts, Offset, Ticks, Number.
      const order = [parts, offset, ticks()[0]!, number()];
      for (let i = 1; i < order.length; i += 1) {
        expect(order[i - 1]!.compareDocumentPosition(order[i]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      }
      expect([parts.value, offset.value]).toEqual(['4', '2.5']);
      const past = state().diagramHistory.past.length;
      act(() => button('Increase Parts')!.click());
      expect(divisions().parts).toBe(5);
      expect(last()).toBe('Change equal divisions');
      // Two to thirty-two.
      act(() => parts.focus());
      setField(parts, '40');
      act(() => parts.blur());
      expect(divisions().parts).toBe(32);
      act(() => button('Increase Offset')!.click());
      expect(divisions().offset).toBe(3);
      // Any tenth typed; no further than 15 mm.
      act(() => offset.focus());
      setField(offset, '2.34');
      act(() => offset.blur());
      expect(divisions().offset).toBe(2.3);
      act(() => offset.focus());
      setField(offset, '20');
      act(() => offset.blur());
      expect(divisions().offset).toBe(15);
      act(() => ticks().find((option) => option.textContent?.trim() === '2')!.click());
      expect(divisions().ticks).toBe(2);
      expect(last()).toBe('Change equal divisions');
      expect(number().getAttribute('aria-checked')).toBe('false');
      act(() => number().click());
      expect(divisions().numbered).toBe(true);
      act(() => number().click());
      expect('numbered' in divisions()).toBe(false);
      expect(state().diagramHistory.past).toHaveLength(past + 8);
      // Flip, as on a pleat arrow: its line to the other side of the edge, and back.
      expect(buttonNamed('Flip Arc')).toBeUndefined();
      act(() => buttonNamed('Flip').click());
      expect('mirrored' in divisions()).toBe(false);
      act(() => buttonNamed('Flip').click());
      expect(divisions().mirrored).toBe(true);
    });

    it('gives new divisions’ Parts the focus, its count selected to be typed over, and Enter gives the canvas its keys back (ED5)', async () => {
      divided();
      const select = vi.spyOn(HTMLInputElement.prototype, 'select');
      const { requestFieldFocus, pendingFieldFocus } = await import('../../diagram/annotate/fieldFocus');
      act(() => {
        requestFieldFocus('d-1', 'parts');
        state().selectDiagramAnnotation('d-1');
      });
      const parts = input('Parts');
      expect(document.activeElement).toBe(parts);
      expect(select.mock.contexts).toContain(parts);
      expect(pendingFieldFocus()).toBeNull();
      // 5 typed over the 4, then Enter.
      setField(parts, '5');
      act(() => {
        parts.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      });
      expect(document.activeElement).not.toBe(parts);
      expect(divisions().parts).toBe(5);
      select.mockRestore();
    });

    it('gives a second mark laid in a row its own count to type over, not the one selected before it (ED5)', async () => {
      const stepId = divided({ parts: 5 });
      act(() => state().selectDiagramAnnotation('d-1'));
      expect(input('Parts').value).toBe('5');
      // The browser drops a field's selection when its value is written: no write may land after the select.
      const selected: { field: HTMLInputElement; value: string }[] = [];
      const writes: HTMLInputElement[] = [];
      const select = vi.spyOn(HTMLInputElement.prototype, 'select').mockImplementation(function (this: HTMLInputElement) {
        selected.push({ field: this, value: this.value });
      });
      const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      const write = vi.spyOn(HTMLInputElement.prototype, 'value', 'set').mockImplementation(function (
        this: HTMLInputElement,
        value: string
      ) {
        if (selected.some(({ field }) => field === this)) writes.push(this);
        valueSetter.call(this, value);
      });
      const { requestFieldFocus } = await import('../../diagram/annotate/fieldFocus');
      // The next mark, along another edge, laid at four parts: the canvas asks for its count.
      act(() => {
        state().editDiagramAnnotations(stepId, 'Add annotation', (list) => [
          ...list,
          { id: 'd-2', kind: 'divisions', from: [0, 0], to: [0, 0.75], parts: 4, offset: 2.5 },
        ]);
        requestFieldFocus('d-2', 'parts');
        state().selectDiagramAnnotation('d-2');
      });
      const parts = input('Parts');
      expect(document.activeElement).toBe(parts);
      expect(parts.value).toBe('4');
      // What was selected is the 4 it shows, and stays selected: a 3 typed is 3, not 43.
      expect(selected.at(-1)).toEqual({ field: parts, value: '4' });
      expect(writes).toEqual([]);
      select.mockRestore();
      write.mockRestore();
    });

    it('warns when their parts are too short for their ticks to print clearly at the size the step prints (ED10)', () => {
      divided({ from: [0.4, 0.2], to: [0.6, 0.2], parts: 32, ticks: 3 });
      act(() => row('Equal Divisions').click());
      const warning = () => host!.querySelector('[role="status"]')?.textContent ?? null;
      // A fifth of a 50 mm picture (10 mm) in 32 parts, three ticks each: crowded.
      expect(warning()).toBe('Too many parts to print clearly at this size.');
      // In four parts there is room for them.
      const parts = input('Parts');
      act(() => parts.focus());
      setField(parts, '4');
      act(() => parts.blur());
      expect(warning()).toBeNull();
    });
  });

  it('flips the selected mark horizontally or vertically from its Flip row, each one undo step, and offers none on a label', () => {
    const stepId = annotatedStep();
    act(() => state().openDiagramStep(stepId, 'annotate'));
    act(() => row('Valley Fold Arrow').click());
    const arrow = () =>
      annotations().find((annotation) => annotation.id === 'a-1') as unknown as { from: number[]; to: number[]; bend?: number };
    // Two mirrors in the Flip row, each named in full.
    const horizontal = button('Flip Horizontal')!;
    const vertical = button('Flip Vertical')!;
    expect(horizontal.querySelector('svg')).not.toBeNull();
    expect(vertical.textContent).toBe('');
    const past = state().diagramHistory.past.length;
    act(() => vertical.click());
    // About its middle: the same ends, bulging the other way.
    expect(arrow()).toMatchObject({ from: [0.1, 0.2], to: [0.5, 0.2], bend: -0.1 });
    expect(state().diagramHistory.past).toHaveLength(past + 1);
    expect(state().diagramHistory.past.at(-1)?.label).toBe('Flip vertical');
    act(() => horizontal.click());
    expect(arrow().from[0]).toBeCloseTo(0.5, 12);
    expect(arrow().to[0]).toBeCloseTo(0.1, 12);
    expect(arrow().bend).toBe(0.1);
    expect(state().diagramHistory.past).toHaveLength(past + 2);
    // A label is its point, the same either way over.
    act(() => row('B').click());
    expect(button('Flip Horizontal')).toBeNull();
  });

  it('scales a close-up with Scale, by halves or to a hundredth, within its range, each one undo step (15f)', () => {
    const stepId = annotatedStep();
    act(() => {
      state().editDiagramAnnotations(stepId, 'Add annotation', (list) => [
        ...list,
        { id: 'z-1', kind: 'close-up', from: [0.5, 0.4], to: [1.2, 0.4], radius: 0.1, scale: 2 },
      ]);
      state().openDiagramStep(stepId, 'annotate');
    });
    act(() => row('Close-Up').click());
    const closeUp = () => annotations().find((annotation) => annotation.id === 'z-1') as Record<string, unknown>;
    const scale = host!.querySelector<HTMLInputElement>('input[aria-label="Scale"]')!;
    expect(scale.value).toBe('2');
    const past = state().diagramHistory.past.length;
    act(() => button('Increase Scale')!.click());
    expect(closeUp().scale).toBe(2.5);
    expect(state().diagramHistory.past).toHaveLength(past + 1);
    expect(state().diagramHistory.past.at(-1)?.label).toBe('Change close-up');
    act(() => scale.focus());
    setField(scale, '3.333');
    act(() => scale.blur());
    expect(closeUp().scale).toBe(3.33);
    act(() => scale.focus());
    setField(scale, '40');
    act(() => scale.blur());
    expect(closeUp().scale).toBe(6);
    // Nothing to flip, shape or put behind: its own controls are its scale and Delete.
    expect(buttonNamed('Flip')).toBeUndefined();
    expect(host!.querySelector('[role="group"][aria-label="Tail"]')).toBeNull();
  });

  it('puts an arrow’s tail and tip behind a flap and how deep, each one undo step, counted the first time (15e)', () => {
    tracked.trackDiagramAnnotationBehind.mockClear();
    const flat = { mode: 'folded-flat' as const, side: 'front' as const, rotationDeg: 0, foldCase: 1 };
    act(() => {
      useWorkspaceStore.setState({ diagram: { ...createDiagram({ newId: () => 'diagram-1' }), steps: [cpStep('step-f', flat)] } });
      state().editDiagramAnnotations('step-f', 'Add annotation', () => [
        { id: 'a-1', kind: 'valley-arrow', from: [0.1, 0.2], to: [0.5, 0.2], bend: 0.1 },
      ]);
      state().openDiagramStep('step-f', 'annotate');
    });
    act(() => row('Valley Fold Arrow').click());
    const side = (end: string, name: string) =>
      [...host!.querySelectorAll<HTMLButtonElement>(`[role="group"][aria-label="${end}"] button`)].find(
        (option) => option.textContent?.trim() === name
      )!;
    const arrow = () => stepsIn(state().diagram!)[0]!.annotations[0] as { behind?: unknown };
    expect(side('Tail', 'In Front').getAttribute('aria-pressed')).toBe('true');
    expect(host!.querySelector('input[aria-label="Under"]')).toBeNull();
    const past = state().diagramHistory.past.length;
    act(() => side('Tail', 'Behind').click());
    expect(arrow().behind).toEqual({ from: 1 });
    expect(state().diagramHistory.past).toHaveLength(past + 1);
    expect(state().diagramHistory.past.at(-1)?.label).toBe('Change behind');
    expect(tracked.trackDiagramAnnotationBehind.mock.calls).toEqual([['valley_arrow', 'tail', '1']]);
    // How deep, for every end behind; the other end goes behind as deep.
    act(() => button('Increase Under')!.click());
    expect(arrow().behind).toEqual({ from: 2 });
    act(() => side('Tip', 'Behind').click());
    expect(arrow().behind).toEqual({ from: 2, to: 2 });
    act(() => side('Tail', 'In Front').click());
    expect(arrow().behind).toEqual({ to: 2 });
    // Counted once: when it first went behind.
    expect(tracked.trackDiagramAnnotationBehind).toHaveBeenCalledTimes(1);
    expect(host!.textContent).not.toContain('Only a folded picture knows its flaps.');
  });

  it('keeps a mark’s place in the folds off on a picture that knows no flaps, and says why (15e)', () => {
    const stepId = annotatedStep();
    act(() => state().openDiagramStep(stepId, 'annotate'));
    act(() => row('Valley Fold Arrow').click());
    const options = [...host!.querySelectorAll<HTMLButtonElement>('[role="group"][aria-label="Tail"] button')];
    expect(options).toHaveLength(2);
    expect(options.every((option) => option.disabled)).toBe(true);
    expect(host!.textContent).toContain('Only a folded picture knows its flaps.');
  });

  it('turns a right angle a quarter clockwise with Turn 90°, as one undo step', () => {
    const stepId = annotatedStep();
    act(() => {
      state().editDiagramAnnotations(stepId, 'Add annotation', (list) => [
        ...list,
        { id: 'a-4', kind: 'right-angle', from: [0.3, 0.3], to: [0.32, 0.3] },
      ]);
      state().openDiagramStep(stepId, 'annotate');
    });
    act(() => row('Right Angle').click());
    expect(buttonNamed('Flip Arc')).toBeUndefined();
    const past = state().diagramHistory.past.length;
    act(() => buttonNamed('Turn 90°').click());
    const turned = annotations()[3] as unknown as { from: [number, number]; to: [number, number] };
    // Opening right, now down: clockwise on the page, about its corner.
    expect(turned.from).toEqual([0.3, 0.3]);
    expect(turned.to[0]).toBeCloseTo(0.3, 12);
    expect(turned.to[1]).toBeCloseTo(0.32, 12);
    expect(state().diagramHistory.past).toHaveLength(past + 1);
  });

  it('sets a white arrow’s width and tail, each one undo step, and shows the template’s for one that says none', () => {
    const stepId = annotatedStep();
    act(() => {
      state().editDiagramAnnotations(stepId, 'Add annotation', (list) => [
        ...list,
        { id: 'w-1', kind: 'white-arrow', from: [0.1, 0.6], to: [0.5, 0.6], path: [{ at: [0.1, 0.6] }, { at: [0.5, 0.6] }] },
      ]);
      state().openDiagramStep(stepId, 'annotate');
    });
    act(() => row('White Arrow').click());
    const options = (group: string) => [...host!.querySelectorAll<HTMLButtonElement>(`[role="group"][aria-label="${group}"] button`)];
    // Each option is a small arrow, named for a screen reader.
    const segment = (group: string, name: string) => options(group).find((option) => option.getAttribute('aria-label') === name)!;
    const checked = (group: string) =>
      options(group)
        .filter((option) => option.getAttribute('aria-pressed') === 'true')
        .map((option) => option.getAttribute('aria-label'));
    expect(checked('Width')).toEqual(['Regular']);
    expect(checked('Tail')).toEqual(['Pointed']);
    const past = state().diagramHistory.past.length;
    act(() => segment('Width', 'Wide').click());
    act(() => segment('Tail', 'Cleft').click());
    const white = annotations().find((annotation) => annotation.id === 'w-1') as { width?: string; tail?: string };
    expect(white).toMatchObject({ width: 'wide', tail: 'cleft' });
    expect(state().diagramHistory.past).toHaveLength(past + 2);
    expect(checked('Width')).toEqual(['Wide']);
    // Its verbs: Flip Arc, and no Reset while it is straight.
    expect(buttonNamed('Flip Arc')).toBeDefined();
    expect(buttonNamed('Reset Shape')).toBeUndefined();
  });

  it('fills a white arrow with ink with Fill and empties it again, each one undo step, a filled one listed as a Solid Arrow (15d)', () => {
    const stepId = annotatedStep();
    act(() => {
      state().editDiagramAnnotations(stepId, 'Add annotation', (list) => [
        ...list,
        { id: 'w-1', kind: 'white-arrow', from: [0.1, 0.6], to: [0.5, 0.6], path: [{ at: [0.1, 0.6] }, { at: [0.5, 0.6] }] },
      ]);
      state().openDiagramStep(stepId, 'annotate');
    });
    act(() => row('White Arrow').click());
    const fill = (name: string) =>
      [...host!.querySelectorAll<HTMLButtonElement>('[role="group"][aria-label="Fill"] button')].find(
        (option) => option.getAttribute('aria-label') === name
      )!;
    // White, for one that says none.
    expect(fill('White').getAttribute('aria-pressed')).toBe('true');
    const past = state().diagramHistory.past.length;
    act(() => fill('Black').click());
    const arrow = () => annotations().find((annotation) => annotation.id === 'w-1') as Record<string, unknown>;
    expect(arrow().fill).toBe('black');
    expect(state().diagramHistory.past).toHaveLength(past + 1);
    expect(state().diagramHistory.past.at(-1)?.label).toBe('Change white arrow');
    // Named by its look in the list, and over its verbs.
    expect(row('Solid Arrow').getAttribute('aria-pressed')).toBe('true');
    expect(row('White Arrow')).toBeUndefined();
    act(() => fill('White').click());
    expect('fill' in arrow()).toBe(false);
    expect(row('White Arrow')).toBeDefined();
  });

  it('edits a label’s text in one line, and focuses it for a label just put down', async () => {
    const stepId = annotatedStep();
    act(() => state().openDiagramStep(stepId, 'annotate'));
    const { requestFieldFocus } = await import('../../diagram/annotate/fieldFocus');
    act(() => {
      requestFieldFocus('a-2', 'text');
      state().selectDiagramAnnotation('a-2');
    });
    const field = host?.querySelector('textarea[maxlength="80"]') as HTMLTextAreaElement;
    expect(document.activeElement).toBe(field);
    setField(field, 'C\nD');
    act(() => field.blur());
    expect(annotations()[1]!.text).toBe('C D');
  });

  it('gives a label just put down its field once the pane is in the page: its tab comes forward after the press', async () => {
    // The dock keeps a tab behind another mounted, its content out of the page.
    const laidOut: (() => void)[] = [];
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(report: () => void) {
          laidOut.push(report);
        }
        observe() {}
        disconnect() {}
      }
    );
    vi.stubGlobal('requestAnimationFrame', (run: FrameRequestCallback) => {
      run(0);
      return 1;
    });
    const stepId = annotatedStep();
    act(() => state().openDiagramStep(stepId, 'annotate'));
    host!.remove();
    const { pendingFieldFocus, requestFieldFocus } = await import('../../diagram/annotate/fieldFocus');
    act(() => {
      state().selectDiagramAnnotation('a-2');
      requestFieldFocus('a-2', 'text');
    });
    const field = host!.querySelector('textarea[maxlength="80"]') as HTMLTextAreaElement;
    expect(document.activeElement).not.toBe(field);
    // Still asked for: a focus out of the page would have spent it.
    expect(pendingFieldFocus()?.annotationId).toBe('a-2');
    document.body.append(host!);
    act(() => laidOut.forEach((report) => report()));
    expect(document.activeElement).toBe(field);
    expect(pendingFieldFocus()).toBeNull();
    vi.unstubAllGlobals();
  });

  it('edits a callout’s words as a label’s, focused for one just put down, and lists it by them', async () => {
    const stepId = annotatedStep();
    act(() => {
      state().editDiagramAnnotations(stepId, 'Add annotation', (list) => [
        ...list,
        { id: 'a-4', kind: 'callout', from: [0.2, 0.7], to: [0.6, 0.3], text: 'Repeat behind' },
      ]);
      state().openDiagramStep(stepId, 'annotate');
    });
    expect(row('Repeat behind')).toBeDefined();
    const { requestFieldFocus } = await import('../../diagram/annotate/fieldFocus');
    act(() => {
      requestFieldFocus('a-4', 'text');
      state().selectDiagramAnnotation('a-4');
    });
    const field = host?.querySelector('textarea[maxlength="80"]') as HTMLTextAreaElement;
    expect(document.activeElement).toBe(field);
    expect(field.value).toBe('Repeat behind');
    setField(field, '裏側も\n同様に');
    act(() => field.blur());
    expect(annotations()[3]!.text).toBe('裏側も 同様に');
    expect(row('裏側も 同様に').getAttribute('aria-pressed')).toBe('true');
  });

  it('leaves what the tool in hand does to the tool window, and keeps the list and the verbs (decision 7)', () => {
    const stepId = annotatedStep();
    act(() => state().openDiagramStep(stepId, 'annotate'));
    const t = i18n.t.bind(i18n);
    for (const tool of ANNOTATE_TOOL_GROUPS.flatMap((group) => group.tools)) {
      act(() => state().setDiagramAnnotateTool(tool));
      expect(host?.textContent).not.toContain(annotateToolHelp(t, tool));
    }
    act(() => state().setDiagramAnnotateTool('edit-path'));
    expect(host?.textContent).not.toContain('Select a fold arrow or a white arrow to shape it.');
    // Its verbs on what is selected stay: the list, Delete.
    act(() => state().selectDiagramAnnotation('a-2'));
    expect(row('B').getAttribute('aria-pressed')).toBe('true');
    expect(buttonNamed('Delete')).toBeDefined();
  });

  describe('with Edit Path in hand', () => {
    const byLabel = (label: string) => host?.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`) ?? null;
    const arrow = () => annotations()[0] as { id: string; bend?: number; path?: { at: number[]; type?: string }[] };

    it('keeps Edit Path in hand to shape what a row selects, offering node verbs only on what it shapes', () => {
      const stepId = annotatedStep();
      act(() => state().openDiagramStep(stepId, 'annotate'));
      act(() => state().setDiagramAnnotateTool('edit-path'));
      // A row pressed keeps Edit Path in hand, to shape what it selected.
      act(() => row('B').click());
      expect(state().diagramAnnotateTool).toBe('edit-path');
      expect(host?.textContent).not.toContain('Node');
      act(() => row('Valley Fold Arrow').click());
      expect(host?.textContent).toContain('2 nodes');
    });

    it('steps through the nodes, and adds, turns and deletes them, each one undo step', () => {
      const stepId = annotatedStep();
      act(() => state().openDiagramStep(stepId, 'annotate'));
      act(() => {
        state().selectDiagramAnnotation('a-1');
        state().setDiagramAnnotateTool('edit-path');
      });
      // The arc's two nodes, none selected: only the steppers act.
      expect(host?.textContent).toContain('2 nodes');
      expect(buttonNamed('Add Node').disabled).toBe(true);
      // Refusing, keeping the focus a press puts on it (`aria-disabled`).
      expect(buttonNamed('Reset Shape').getAttribute('aria-disabled')).toBe('true');
      act(() => byLabel('Next Node')!.click());
      expect(host?.textContent).toContain('Node 1 of 2');
      expect(arrow().bend).toBe(0.1);
      const past = state().diagramHistory.past.length;
      act(() => buttonNamed('Add Node').click());
      expect(arrow().path).toHaveLength(3);
      expect(host?.textContent).toContain('Node 2 of 3');
      act(() => buttonNamed('Corner').click());
      expect(arrow().path![1]!.type).toBe('corner');
      expect(buttonNamed('Corner').getAttribute('aria-checked') ?? buttonNamed('Corner').getAttribute('aria-pressed')).toBe('true');
      act(() => byLabel('Next Node')!.click());
      expect(host?.textContent).toContain('Node 3 of 3');
      // An end has no type to have.
      expect(buttonNamed('Smooth').disabled).toBe(true);
      act(() => buttonNamed('Delete Node').click());
      expect(arrow().path).toHaveLength(2);
      expect(host?.textContent).toContain('Node 2 of 2');
      expect(state().diagramHistory.past).toHaveLength(past + 3);
      act(() => buttonNamed('Reset Shape').click());
      expect(arrow().path).toBeUndefined();
      expect(host?.textContent).toContain('2 nodes');
      // Back on the arc: the node selected is none, and Delete takes the arrow, not a node.
      act(() => buttonNamed('Delete').click());
      expect(annotations().map((annotation) => annotation.id)).toEqual(['a-2', 'a-3']);
    });
  });
});
