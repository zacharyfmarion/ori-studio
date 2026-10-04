import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cpDocument } from '../../diagram/capture/capture.fixtures';
import { createDiagram } from '../../diagram/document/diagramDocument';
import { cpStep, referencesStep, stepsIn } from '../../diagram/document/diagramSteps.fixtures';
import { buildDiagramLinkedPoseActions } from '../../diagram/actions/diagramLinkedPoseActions';
import { publishOpenLinkedPose } from '../../diagram/capture/openLinkedPose';
import type { OristudioCpDocumentState } from '../../engine/oristudioCpTypes';
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
const ids = () => stepsIn(state().diagram!).map((step) => step.id) ?? [];
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
    expect(stepsIn(state().diagram!).find((step) => step.id === third)?.text).toBe('Fold in half.');
    expect(state().diagramHistory.past).toHaveLength(past + 1);
  });

  it('shows a turn between steps as what it is and where, and changes and deletes it (D22)', () => {
    const [first] = threeSteps();
    let turn = '';
    act(() => {
      turn = state().insertDiagramTurn({ kind: 'turn-over', axis: 'vertical' }, { stepId: first!, where: 'after' })!;
    });
    expect(host!.textContent).toContain('Turn over, side to side');
    expect(host!.textContent).toContain('Between steps 1 and 2');
    // No instruction, no position: a turn has neither.
    expect(instruction()).toBeNull();
    const option = (label: string) =>
      [...host!.querySelectorAll<HTMLElement>('button[aria-pressed]')].find((element) => element.textContent === label)!;
    act(() => option('Rotate').click());
    expect(state().diagram!.steps[1]).toEqual({ id: turn, kind: 'rotate', rotate: { amount: 'quarter', direction: 'cw' } });
    expect(host!.textContent).toContain('Rotate 1/4 turn clockwise');
    // Each control its own name.
    expect([...host!.querySelectorAll('[role="group"]')].map((group) => group.getAttribute('aria-label'))).toEqual([
      'Turn',
      'Amount',
      'Direction',
      'Turn actions',
    ]);
    const remove = [...host!.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === 'Delete Turn')!;
    act(() => remove.click());
    expect(state().diagram!.steps.some((entry) => entry.id === turn)).toBe(false);
  });

  it('numbers and walks the steps alone, past a turn between them', () => {
    const [first, second, third] = threeSteps();
    act(() => {
      state().insertDiagramTurn({ kind: 'turn-over', axis: 'vertical' }, { stepId: first!, where: 'after' });
      state().selectDiagramStep(third!);
    });
    expect(position().value).toBe('3');
    act(() => button('Previous Step')?.click());
    expect(state().diagramSelectedStepId).toBe(second);
    act(() => button('Previous Step')?.click());
    expect(state().diagramSelectedStepId).toBe(first);
    // Typed to 2: before the step that becomes 3. The turn stays before the step it was before.
    act(() => position().focus());
    setField(position(), '2');
    act(() => position().blur());
    expect(state().diagram!.steps.map((entry) => ('kind' in entry ? 'turn' : entry.id))).toEqual(['turn', second, first, third]);
    expect(position().value).toBe('2');
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

  it('goes to the step before and after, and runs the header verbs', () => {
    const [first, second, third] = threeSteps();
    // ‹ and › go to the neighbours, as the detail's do; they move nothing.
    expect(button('Next Step')?.disabled).toBe(true);
    act(() => button('Previous Step')?.click());
    expect(state().diagramSelectedStepId).toBe(second);
    expect(position().value).toBe('2');
    act(() => button('Previous Step')?.click());
    expect(state().diagramSelectedStepId).toBe(first);
    expect(button('Previous Step')?.disabled).toBe(true);
    act(() => button('Next Step')?.click());
    expect(state().diagramSelectedStepId).toBe(second);
    expect(ids()).toEqual([first, second, third]);

    act(() => button('Duplicate Step')?.click());
    expect(ids()).toHaveLength(4);
    expect(state().diagramSelectedStepId).toBe(ids()[2]);

    // An empty step goes without a question.
    act(() => button('Delete Step')?.click());
    expect(ids()).toEqual([first, second, third]);
  });

  describe('the picture', () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="1105.6" height="800" viewBox="0 0 1105.6 800"/>';
    const asset = { id: 'asset-a', kind: 'svg' as const, svg, widthPx: 1105.6, heightPx: 800, bytes: svg.length };
    const textButton = (label: string) =>
      [...(host?.querySelectorAll('button') ?? [])].find((candidate) => candidate.textContent === label);
    /** The option pressed in a segmented row, by the row's name. */
    const pressed = (label: string) =>
      host?.querySelector(`[aria-label="${label}"] button[aria-pressed="true"]`)?.textContent ?? null;

    it('offers only the ways to a first picture for a step without one', () => {
      act(() => {
        state().addDiagramStep();
      });
      expect(host?.textContent).toContain('No picture yet');
      expect(textButton('Upload Picture…')?.disabled).toBe(false);
      for (const dead of ['Adjust Pose', 'Export Picture…', 'Remove Picture', 'Refresh Picture']) {
        expect(textButton(dead)).toBeUndefined();
      }
    });

    it('shows the pose only while the step is open in detail, and no verbs: they are Pose’s toolbar’s', () => {
      let stepId = '';
      act(() => {
        stepId = state().addDiagramStep()!;
        state().setDiagramStepPicture(stepId, asset);
        state().setDiagramStepPose(stepId, { rotationQuarterTurns: 1, mirrored: true });
      });
      expect(host?.textContent).not.toContain('clockwise');
      act(() => textButton('Adjust Pose')?.click());
      expect(state().diagramDetail).toBe('pose');
      // Open in Pose, the verb leads nowhere new.
      expect(textButton('Adjust Pose')).toBeUndefined();
      expect(host?.textContent).toContain('90° clockwise');
      expect(host?.textContent).toContain('FlippedYes');
      for (const verb of ['Rotate Left', 'Rotate Right', 'Flip', 'Reset Pose']) {
        expect(textButton(verb)).toBeUndefined();
      }
      act(() => state().setDiagramStepPose(stepId, { rotationQuarterTurns: 0, mirrored: false }));
      expect(host?.textContent).toContain('0° clockwise');
      expect(host?.textContent).toContain('FlippedNo');
    });

    it('opens the References browser to fill an empty step from From References…', () => {
      let stepId = '';
      act(() => {
        // A pattern open, so there is something to plan.
        useWorkspaceStore.setState({
          oristudioCpDocument: { handle: 1, document: cpDocument(), geometry: null } as unknown as OristudioCpDocumentState,
        });
        stepId = state().addDiagramStep()!;
      });
      act(() => textButton('From References…')!.click());
      expect(state().diagramReferencesBrowser?.anchor).toEqual({ kind: 'fill', stepId });
    });

    it('says which way a 3D step looks at its model', () => {
      act(() => {
        const step = cpStep('step-3d', { mode: 'folded-3d', camera: { yaw: Math.PI / 4, pitch: -0.955, zoom: 1 }, side: 'front' });
        useWorkspaceStore.setState({ diagram: { ...createDiagram({ newId: () => 'diagram-1' }), steps: [step] } });
        state().selectDiagramStep('step-3d');
      });
      expect(host?.textContent).toContain('ViewYaw 45° · Pitch -55°');
    });

    it('turns a step sent from References over from the pane, by choosing its side', () => {
      act(() => {
        useWorkspaceStore.setState({ diagram: { ...createDiagram({ newId: () => 'diagram-1' }), steps: [referencesStep('step-r')] } });
        state().openDiagramStep('step-r');
      });
      expect(pressed('Side')).toBe('Front');
      expect(textButton('Turn Over')).toBeUndefined();
      act(() => textButton('Back')?.click());
      expect(stepsIn(state().diagram!)[0]!.picture).toMatchObject({ kind: 'step-diagram', mirrored: true });
      expect(pressed('Side')).toBe('Back');
      // The side it shows already: nothing to turn.
      act(() => textButton('Back')?.click());
      expect(stepsIn(state().diagram!)[0]!.picture).toMatchObject({ mirrored: true });
    });

    it('poses a linked flat fold from the pane with the open step’s own verbs, and its turn as a field', () => {
      const pose = vi.fn();
      const rotateTo = vi.fn();
      const render = { mode: 'folded-flat' as const, side: 'back' as const, rotationDeg: 30, foldCase: 2 };
      act(() => {
        useWorkspaceStore.setState({ diagram: { ...createDiagram({ newId: () => 'diagram-1' }), steps: [cpStep('step-f', render)] } });
        state().openDiagramStep('step-f');
        const actions = buildDiagramLinkedPoseActions(
          { render, readOnly: false, busy: false, solutions: { discovered: 1, hasNext: true } },
          { t: ((_key: string, fallback: string) => fallback) as never, pose }
        );
        publishOpenLinkedPose('step-f', {
          actions,
          layerOrder: { count: '2 of 2+', label: 'Layer order 2 of 2+' },
          spatial: null,
          onCamera: () => {},
          rotateTo,
          showAs: async () => true,
          simulate: async () => {},
          wantsRest: () => false,
        });
      });
      expect(pressed('Side')).toBe('Back');
      expect(host?.textContent).toContain('Layer order2 of 2+');
      act(() => textButton('Front')?.click());
      expect(pose).toHaveBeenCalledWith('turn-over');
      // Show as leads the pane, above the pose.
      const showAs = host!.querySelector('[role="group"][aria-label="Show as"]')!;
      const rotationField = host!.querySelector('input[aria-label="Rotation"]')!;
      expect(showAs.compareDocumentPosition(rotationField) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      const rotation = host!.querySelector<HTMLInputElement>('input[aria-label="Rotation"]')!;
      expect(rotation.value).toBe('30');
      act(() => rotation.focus());
      setField(rotation, '100');
      act(() => rotation.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
      expect(rotateTo).toHaveBeenCalledWith(100);
      act(() => publishOpenLinkedPose(null, null));
    });

    it('says what the picture is, what sanitizing changed, and removes it', () => {
      act(() => {
        const stepId = state().addDiagramStep()!;
        state().setDiagramStepPicture(stepId, asset);
        state().noteDiagramPictureChanges('asset-a', ['flowed-text', 'css-dropped']);
      });
      expect(host?.textContent).toContain('Uploaded SVG, 1106 × 800 px');
      expect(host?.textContent).toContain('This picture was simplified.');
      expect(host?.textContent).toContain('Flowed text isn’t supported');
      expect(textButton('Replace Picture…')).toBeDefined();

      act(() => textButton('Remove Picture')?.click());
      expect(host?.textContent).toContain('No picture yet');
      expect(host?.textContent).not.toContain('simplified');
      expect(stepsIn(state().diagram!)[0].text).toBe('');
    });
  });
});

describe('DiagramStepPanel in Annotate', () => {
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

  it('counts them out of Annotate, and leads in', () => {
    const stepId = annotatedStep();
    expect(host?.textContent).toContain('3 annotations');
    act(() => buttonNamed('Annotate').click());
    expect(state().diagramDetail).toBe('annotate');
    expect(state().diagramSelectedStepId).toBe(stepId);
  });

  it('lists them, selects one with a press, and offers its own controls', () => {
    const stepId = annotatedStep();
    act(() => state().openDiagramStep(stepId, 'annotate'));
    expect(host?.textContent).toContain('Select');
    // A row pressed with a drawing tool in hand puts Select back, to move what it selected.
    act(() => state().setDiagramAnnotateTool('mountain-line'));
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

  it('edits a label’s text in one line, and focuses it for a label just put down', async () => {
    const stepId = annotatedStep();
    act(() => state().openDiagramStep(stepId, 'annotate'));
    const { requestLabelFocus } = await import('../../diagram/annotate/labelFocus');
    act(() => {
      requestLabelFocus('a-2');
      state().selectDiagramAnnotation('a-2');
    });
    const field = host?.querySelector('textarea[maxlength="80"]') as HTMLTextAreaElement;
    expect(document.activeElement).toBe(field);
    setField(field, 'C\nD');
    act(() => field.blur());
    expect(annotations()[1]!.text).toBe('C D');
  });

  it('says when the picture changed under them, and keeps them on a press', () => {
    const stepId = annotatedStep();
    act(() => state().openDiagramStep(stepId, 'annotate'));
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 10 10"/>';
    act(() => {
      state().setDiagramStepPicture(stepId, { id: 'asset-2', kind: 'svg', svg, widthPx: 10, heightPx: 10, bytes: 1 });
    });
    expect(host?.textContent).toContain('The picture changed since these annotations were drawn.');
    act(() => buttonNamed('Keep Them Here').click());
    expect(host?.textContent).not.toContain('The picture changed');
  });

  describe('with Edit Path in hand', () => {
    const byLabel = (label: string) => host?.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`) ?? null;
    const arrow = () => annotations()[0] as { id: string; bend?: number; path?: { at: number[]; type?: string }[] };

    it('says what it shapes, and that it shapes nothing else', () => {
      const stepId = annotatedStep();
      act(() => state().openDiagramStep(stepId, 'annotate'));
      act(() => state().setDiagramAnnotateTool('edit-path'));
      expect(host?.textContent).toContain('Edit Path');
      expect(host?.textContent).toContain('Select a fold arrow to shape it.');
      // A row pressed keeps Edit Path in hand, to shape what it selected.
      act(() => row('B').click());
      expect(state().diagramAnnotateTool).toBe('edit-path');
      expect(host?.textContent).toContain('Only fold arrows can be shaped');
      expect(host?.textContent).not.toContain('Node');
      act(() => row('Valley Fold Arrow').click());
      expect(host?.textContent).toContain('Drag a fold arrow’s nodes');
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
      expect(buttonNamed('Reset Shape').disabled).toBe(true);
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
